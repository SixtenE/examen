import { db } from "@/db";
import { matches, queries } from "@/db/schema";
import type { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3Client } from "@/lib/s3";
import { DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { isUuid } from "@/lib/utils";
import { enforceRateLimit } from "@/lib/rate-limit";
import { trackServerError, trackServerEvent, withSpan } from "@/lib/telemetry";
import { getQueryOwnerId } from "@/lib/query-owner";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const rateLimitResponse = await enforceRateLimit(request, {
    scope: "api:queries:id:get",
  });
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const { id } = await params;

  if (!isUuid(id)) {
    return Response.json({ error: "Query not found" }, { status: 404 });
  }

  try {
    const ownerId = getQueryOwnerId(request);
    if (!ownerId) {
      return Response.json({ error: "Query not found" }, { status: 404 });
    }

    const [query] = await withSpan("db.get_query", { query_id: id }, () =>
      db
        .select({
          id: queries.id,
          title: queries.title,
          image_key: queries.image_key,
          status: queries.status,
          createdAt: queries.createdAt,
        })
        .from(queries)
        .where(and(eq(queries.id, id), eq(queries.owner_id, ownerId))),
    );

    if (!query) {
      return Response.json({ error: "Query not found" }, { status: 404 });
    }

    const image_url = await withSpan(
      "storage.sign_query_image",
      { query_id: id },
      () =>
        getSignedUrl(
          s3Client,
          new GetObjectCommand({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: query.image_key,
          }),
          {
            expiresIn: 60 * 60, // 1 hour
          },
        ),
    );

    return Response.json({
      id: query.id,
      title: query.title,
      status: query.status,
      createdAt: query.createdAt,
      image_url,
    });
  } catch (error) {
    trackServerError(request, error, "query_fetch", { query_id: id });
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const startedAt = performance.now();
  const rateLimitResponse = await enforceRateLimit(request, {
    scope: "api:queries:id:delete",
    failClosed: true,
  });
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const { id } = await params;

  if (!isUuid(id)) {
    return Response.json({ error: "Query not found" }, { status: 404 });
  }

  try {
    const ownerId = getQueryOwnerId(request);
    if (!ownerId) {
      return Response.json({ error: "Query not found" }, { status: 404 });
    }

    const [query] = await db
      .select({ image_key: queries.image_key })
      .from(queries)
      .where(and(eq(queries.id, id), eq(queries.owner_id, ownerId)));

    if (!query) {
      return Response.json({ error: "Query not found" }, { status: 404 });
    }

    await withSpan("db.delete_query", { query_id: id }, () =>
      db.transaction(async (tx) => {
        await tx.delete(matches).where(eq(matches.query_id, id));
        await tx
          .delete(queries)
          .where(and(eq(queries.id, id), eq(queries.owner_id, ownerId)));
      }),
    );

    trackServerEvent(request, "query_deleted", {
      query_id: id,
      duration_ms: Math.round(performance.now() - startedAt),
    });

    try {
      await s3Client.send(
        new DeleteObjectCommand({
          Bucket: process.env.AWS_BUCKET_NAME,
          Key: query.image_key,
        }),
      );
    } catch (error) {
      console.error("query delete S3 cleanup error:", error);
    }

    return Response.json({ message: "Query deleted" }, { status: 200 });
  } catch (error) {
    trackServerError(request, error, "query_delete", {
      query_id: id,
      duration_ms: Math.round(performance.now() - startedAt),
    });
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
