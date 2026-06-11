import { db } from "@/db";
import { matches, queries } from "@/db/schema";
import { embedImageUrl } from "@/lib/embeddings";
import { qdrantClient } from "@/lib/qdrant";
import { s3Client } from "@/lib/s3";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { and, desc, eq, ne } from "drizzle-orm";
import type { NextRequest } from "next/server";

const MATCH_LIMIT = 32;

type ReferencePayload = {
  auctionet_id: string;
  image_index: number;
  image_url: string;
  title: string;
  price: number;
  currency: string;
  source_url: string;
};

type ReferenceSearchHit = {
  score: number;
  payload?: ReferencePayload | null;
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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

    //remove duplicates from results and keep the highest similarity score
    const uniqueResults = results.filter(
      (result, index, self) =>
        index === self.findIndex((t) => t.auctionet_id === result.auctionet_id),
    );

    return Response.json(uniqueResults);
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
    // Atomically claim the query for generation: only one caller can flip a
    // non-processing query to "processing", so concurrent loads can't both run
    // the (expensive) embed + search.
    const [claimed] = await db
      .update(queries)
      .set({ status: "processing" })
      .where(and(eq(queries.id, id), ne(queries.status, "processing")))
      .returning();

    if (!claimed) {
      const [existing] = await db
        .select()
        .from(queries)
        .where(eq(queries.id, id));

      if (!existing) {
        return Response.json({ error: "Query not found" }, { status: 404 });
      }

      return Response.json({ status: "processing" });
    }

    const query = claimed;

    const imageUrl = await getSignedUrl(
      s3Client,
      new GetObjectCommand({
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: query.image_key,
      }),
      { expiresIn: 60 * 5 },
    );

    const vector = await embedImageUrl(imageUrl);

    const searchResults = (await qdrantClient.search("references", {
      vector,
      limit: MATCH_LIMIT,
      with_payload: true,
    })) as ReferenceSearchHit[];

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
          image_url: result.payload?.image_url ?? "",
          title: result.payload?.title ?? "",
          price: result.payload?.price ?? 0,
          currency: result.payload?.currency ?? "",
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);

    const uniqueRows = [
      ...rows
        .reduce((map, row) => {
          const existing = map.get(row.auctionet_id);
          if (!existing || row.similarity_score > existing.similarity_score) {
            map.set(row.auctionet_id, row);
          }
          return map;
        }, new Map<string, (typeof rows)[number]>())
        .values(),
    ];

    const persisted = await db.transaction(async (tx) => {
      await tx.delete(matches).where(eq(matches.query_id, id));

      if (uniqueRows.length === 0) {
        return [];
      }

      return tx.insert(matches).values(uniqueRows).returning();
    });

    await db.update(queries).set({ status: "ready" }).where(eq(queries.id, id));

    return Response.json(persisted);
  } catch (error) {
    console.error("matches route error:", error);

    // Best-effort: mark the query failed so the page can surface a retry
    // instead of being stuck on "processing".
    try {
      await db
        .update(queries)
        .set({ status: "failed" })
        .where(eq(queries.id, id));
    } catch (statusError) {
      console.error("matches route status update error:", statusError);
    }

    return Response.json(
      {
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 },
    );
  }
}
