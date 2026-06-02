import { QdrantClient } from "@qdrant/js-client-rest";

if (!process.env.QDRANT_URL) {
  throw new Error("QDRANT_URL must be set");
}

export const qdrantClient = new QdrantClient({
  url: process.env.QDRANT_URL,
  port: null,
  checkCompatibility: false,
});
