import { QdrantClient } from "@qdrant/js-client-rest";
import { EMBEDDING_DIMENSIONS } from "./embeddings";
import { referenceCollection } from "./catalog-paths";

if (!process.env.QDRANT_URL) {
  throw new Error("QDRANT_URL must be set");
}

export const qdrantClient = new QdrantClient({
  url: process.env.QDRANT_URL,
  port: null,
  checkCompatibility: false,
  apiKey: process.env.QDRANT_API_KEY!,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getAnonymousVectorParams(collectionInfo: unknown) {
  if (!isRecord(collectionInfo) || !isRecord(collectionInfo.config)) {
    return null;
  }

  const { params } = collectionInfo.config;
  if (!isRecord(params) || !isRecord(params.vectors)) {
    return null;
  }

  const { size, distance } = params.vectors;
  if (typeof size !== "number" || typeof distance !== "string") {
    return null;
  }

  const hnsw = collectionInfo.config.hnsw_config;

  return {
    size,
    distance,
    vectorsOnDisk: params.vectors.on_disk === true,
    hnswOnDisk: isRecord(hnsw) && hnsw.on_disk === true,
  };
}

async function validateCollectionConfig(collectionName: string) {
  const vectorParams = getAnonymousVectorParams(
    await qdrantClient.getCollection(collectionName),
  );

  if (!vectorParams) {
    throw new Error(`${collectionName} collection must use an anonymous dense vector`);
  }

  if (
    vectorParams.size !== EMBEDDING_DIMENSIONS ||
    vectorParams.distance.toLowerCase() !== "cosine"
  ) {
    throw new Error(
      `${collectionName} collection has ${vectorParams.size}/${vectorParams.distance}, expected ${EMBEDDING_DIMENSIONS}/Cosine. Re-run with --recreate to rebuild it.`,
    );
  }

  return vectorParams;
}

/** Move vectors and the HNSW graph off the heap; takes effect as segments are optimized. */
async function enforceOnDiskStorage(
  collectionName: string,
  current: { vectorsOnDisk: boolean; hnswOnDisk: boolean },
) {
  if (current.vectorsOnDisk && current.hnswOnDisk) {
    return;
  }

  await qdrantClient.updateCollection(collectionName, {
    vectors: { "": { on_disk: true } },
    hnsw_config: { on_disk: true },
  });
  console.log(`moved to disk: ${collectionName}`);
}

/** Create or validate the Qdrant collection for one Auctionet Category. */
export async function ensureReferenceCollection(
  segment: string,
  options: { recreate?: boolean } = {},
) {
  const collectionName = referenceCollection(segment);
  // Disk-resident storage: RAM is the binding constraint, search latency is not.
  const collectionConfig = {
    vectors: {
      size: EMBEDDING_DIMENSIONS,
      distance: "Cosine" as const,
      on_disk: true,
    },
    hnsw_config: { on_disk: true },
    on_disk_payload: true,
  };

  if (options.recreate) {
    await qdrantClient.recreateCollection(collectionName, collectionConfig);
    await validateCollectionConfig(collectionName);
    console.log(`recreated collection: ${collectionName}`);
    return collectionName;
  }

  const { exists } = await qdrantClient.collectionExists(collectionName);
  if (exists) {
    const current = await validateCollectionConfig(collectionName);
    await enforceOnDiskStorage(collectionName, current);
    console.log(`collection exists: ${collectionName}`);
    return collectionName;
  }

  await qdrantClient.createCollection(collectionName, collectionConfig);
  await validateCollectionConfig(collectionName);
  console.log(`created collection: ${collectionName}`);
  return collectionName;
}
