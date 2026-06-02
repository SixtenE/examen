import { db } from "@/db";
import { matches, queries } from "@/db/schema";
import { embedImageUrl } from "@/lib/embeddings";
import { qdrantClient } from "@/lib/qdrant";
import { s3Client } from "@/lib/s3";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { desc, eq } from "drizzle-orm";
import type { NextRequest } from "next/server";

const MATCH_LIMIT = 6;

export async function GET({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const [query] = await db.select().from(queries).where(eq(queries.id, id));

    if (!query) {
      return Response.json({ error: "Query not found" }, { status: 404 });
    }

    const results = await db
      .select()
      .from(matches)
      .where(eq(matches.query_id, id))
      .orderBy(desc(matches.similarity_score));

    return Response.json(results);
  } catch {
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const [query] = await db.select().from(queries).where(eq(queries.id, id));

    if (!query) {
      return Response.json({ error: "Query not found" }, { status: 404 });
    }

    const imageUrl = await getSignedUrl(
      s3Client,
      new GetObjectCommand({
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: query.image_key,
      }),
      { expiresIn: 60 * 5 },
    );

    const vector = await embedImageUrl(imageUrl);

    const searchResults = await qdrantClient.search("images", {
      vector,
      limit: MATCH_LIMIT,
      with_payload: true,
    });

    const rows = searchResults
      .map((result) => {
        const auctionetId = result.payload?.auctionet_id;
        if (typeof auctionetId !== "string" || auctionetId.length === 0) {
          return null;
        }

        return {
          query_id: id,
          auctionet_id: auctionetId,
          similarity_score: result.score,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);

    const persisted = await db.transaction(async (tx) => {
      await tx.delete(matches).where(eq(matches.query_id, id));

      if (rows.length === 0) {
        return [];
      }

      return tx.insert(matches).values(rows).returning();
    });

    return Response.json(persisted);
  } catch (error) {
    console.error("matches route error:", error);
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 },
    );
  }
}
