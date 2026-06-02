const EMBEDDING_MODEL = "google/gemini-embedding-2";
const EMBEDDING_DIMENSIONS = 768;

export async function embedImageUrl(imageUrl: string): Promise<number[]> {
  const response = await fetch("https://openrouter.ai/api/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: [
        {
          content: [
            {
              type: "image_url",
              image_url: {
                url: imageUrl,
              },
            },
          ],
        },
      ],
      encoding_format: "float",
      dimensions: EMBEDDING_DIMENSIONS,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      typeof data === "object" && data !== null && "error" in data
        ? JSON.stringify(data.error)
        : "Embedding request failed",
    );
  }

  const embedding = data.data?.[0]?.embedding;
  if (!Array.isArray(embedding)) {
    throw new Error("Embedding response missing vector");
  }

  return embedding;
}
