import { db } from "@/db";
import { matches, queries } from "@/db/schema";
import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { requireAwsBucketName, s3Client } from "@/lib/s3";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { isUuid } from "@/lib/utils";
import { enforceRateLimit } from "@/lib/rate-limit";

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
    const [query] = await db.select().from(queries).where(eq(queries.id, id));

    if (!query) {
      return Response.json({ error: "Query not found" }, { status: 404 });
    }

    const image_url = await getSignedUrl(
      s3Client,
      new GetObjectCommand({
        Bucket: requireAwsBucketName(),
        Key: query.image_key,
      }),
      {
        expiresIn: 60 * 60, // 1 hour
      },
    );

    return Response.json({ ...query, image_url });
  } catch {
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const rateLimitResponse = await enforceRateLimit(request, {
    scope: "api:queries:id:delete",
  });
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const { id } = await params;

  if (!isUuid(id)) {
    return Response.json({ error: "Query not found" }, { status: 404 });
  }

  try {
    await db.transaction(async (tx) => {
      await tx.delete(matches).where(eq(matches.query_id, id));
      await tx.delete(queries).where(eq(queries.id, id));
    });

    return Response.json({ message: "Query deleted" }, { status: 200 });
  } catch {
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
