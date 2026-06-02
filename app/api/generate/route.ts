import { qdrantClient } from "@/lib/qdrant";
import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const {
      image_url,
      auctionet_id,
    }: { image_url: string; auctionet_id: string } = await request.json();

    if (!image_url || !auctionet_id) {
      return Response.json(
        { error: "Missing required fields" },
        { status: 400 },
      );
    }

    const response = await fetch("https://openrouter.ai/api/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-embedding-2",
        input: [
          {
            content: [
              {
                type: "image_url",
                image_url: {
                  url: image_url,
                },
              },
            ],
          },
        ],
        encoding_format: "float",
        dimensions: 768,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return Response.json({ error: data }, { status: response.status });
    }

    const embedding = await qdrantClient.upsert("images", {
      wait: true,
      points: [
        {
          id: crypto.randomUUID(),
          payload: {
            auctionet_id: auctionet_id,
          },
          vector: data.data[0].embedding,
        },
      ],
    });

    return Response.json(embedding);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
