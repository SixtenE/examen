import { db } from "@/db";
import { matches, queries } from "@/db/schema";
import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3Client } from "@/lib/s3";
import { GetObjectCommand } from "@aws-sdk/client-s3";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const [query] = await db.select().from(queries).where(eq(queries.id, id));

    if (!query) {
      return Response.json({ error: "Image not found" }, { status: 404 });
    }

    const image_url = await getSignedUrl(
      s3Client,
      new GetObjectCommand({
        Bucket: process.env.AWS_BUCKET_NAME,
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
  const { id } = await params;

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
