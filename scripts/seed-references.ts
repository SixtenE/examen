import "dotenv/config";

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

type QdrantClient = typeof import("../lib/qdrant").qdrantClient;

type CliOptions = {
  vectorsDir: string;
  itemsDir: string;
  batchSize: number;
  force: boolean;
  dryRun: boolean;
  recreate: boolean;
  maxItems: number | null;
  reverse: boolean;
};

type ReferenceVector = {
  image_index: number;
  image_url: string;
  embedding: number[];
};

type VectorArtifact = {
  auctionet_id: number;
  source_url: string | null;
  title: string | null;
  embedded_at: string;
  model: string;
  dimensions: number;
  references: ReferenceVector[];
};

type AuctionetItemJson = {
  auctionet_id: number;
  source_url: string | null;
  title: string | null;
  price: number | null;
  currency: string;
};

type ReferencePayload = {
  auctionet_id: string;
  image_index: number;
  image_url: string;
  title: string;
  price: number | null;
  currency: string;
  source_url: string;
};

type ReferencePoint = {
  id: number;
  vector: number[];
  payload: ReferencePayload;
};

type Summary = {
  uploaded: number;
  skipped: number;
  failed: number;
  references: number;
};

const DEFAULT_VECTORS_DIR = "data/auctionet/vectors";
const DEFAULT_ITEMS_DIR = "data/auctionet/items";
const DEFAULT_BATCH_SIZE = 100;
const COLLECTION_NAME = "references";
const EMBEDDING_MODEL = "google/gemini-embedding-2";
const EMBEDDING_DIMENSIONS = 3072;
const MAX_REFERENCES_PER_ITEM = 100;

function usage() {
  return [
    "Usage: pnpm seed:references -- [options]",
    "",
    "Options:",
    `  --vectors <dir>     Vector Artifact JSON directory (default: ${DEFAULT_VECTORS_DIR})`,
    `  --items <dir>       Auctionet Item JSON directory (default: ${DEFAULT_ITEMS_DIR})`,
    `  --batch-size <n>    Qdrant points per upsert (default: ${DEFAULT_BATCH_SIZE})`,
    "  --max-items <n>     Stop after processing n Vector Artifacts",
    "  --reverse           Process artifacts in reverse discovery order (newest paths first)",
    "  --force             Re-upload artifacts even if all expected points already exist",
    "  --recreate          Delete and recreate the Qdrant collection before seeding",
    "  --dry-run           Print planned work without calling Qdrant",
  ].join("\n");
}

function readOptionValue(args: string[], index: number, name: string) {
  const value = args[index + 1];

  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }

  return value;
}

function parsePositiveInteger(value: string, name: string) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

function parseArgs(args: string[]): CliOptions {
  let vectorsDir = DEFAULT_VECTORS_DIR;
  let itemsDir = DEFAULT_ITEMS_DIR;
  let batchSize = DEFAULT_BATCH_SIZE;
  let force = false;
  let dryRun = false;
  let recreate = false;
  let maxItems: number | null = null;
  let reverse = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    switch (arg) {
      case "--":
        break;
      case "--vectors":
        vectorsDir = readOptionValue(args, index, arg);
        index += 1;
        break;
      case "--items":
        itemsDir = readOptionValue(args, index, arg);
        index += 1;
        break;
      case "--batch-size":
        batchSize = parsePositiveInteger(readOptionValue(args, index, arg), arg);
        index += 1;
        break;
      case "--max-items":
        maxItems = parsePositiveInteger(readOptionValue(args, index, arg), arg);
        index += 1;
        break;
      case "--force":
        force = true;
        break;
      case "--dry-run":
        dryRun = true;
        break;
      case "--recreate":
        recreate = true;
        break;
      case "--reverse":
        reverse = true;
        break;
      case "--help":
      case "-h":
        console.log(usage());
        process.exit(0);
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return {
    vectorsDir,
    itemsDir,
    batchSize,
    force,
    dryRun,
    recreate,
    maxItems,
    reverse,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function discoverJsonFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await discoverJsonFiles(entryPath)));
      continue;
    }

    if (entry.isFile() && /^\d+\.json$/.test(entry.name)) {
      files.push(entryPath);
    }
  }

  return files.sort();
}

function validateReference(value: unknown, filePath: string, index: number): ReferenceVector {
  if (!isRecord(value)) {
    throw new Error(`${filePath} reference ${index} must be an object`);
  }

  const imageIndex = value.image_index;
  if (!Number.isInteger(imageIndex) || typeof imageIndex !== "number" || imageIndex < 0) {
    throw new Error(`${filePath} reference ${index} is missing non-negative integer image_index`);
  }

  if (imageIndex >= MAX_REFERENCES_PER_ITEM) {
    throw new Error(
      `${filePath} reference ${index} image_index ${imageIndex} exceeds deterministic ID limit ${MAX_REFERENCES_PER_ITEM - 1}`,
    );
  }

  if (typeof value.image_url !== "string" || value.image_url.length === 0) {
    throw new Error(`${filePath} reference ${index} is missing image_url`);
  }

  if (!Array.isArray(value.embedding) || !value.embedding.every((entry) => typeof entry === "number")) {
    throw new Error(`${filePath} reference ${index} is missing numeric embedding array`);
  }

  if (value.embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `${filePath} reference ${index} has ${value.embedding.length} dimensions, expected ${EMBEDDING_DIMENSIONS}`,
    );
  }

  return {
    image_index: imageIndex,
    image_url: value.image_url,
    embedding: value.embedding,
  };
}

function validateVectorArtifact(value: unknown, filePath: string): VectorArtifact {
  if (!isRecord(value)) {
    throw new Error(`${filePath} must contain a JSON object`);
  }

  if (typeof value.auctionet_id !== "number") {
    throw new Error(`${filePath} is missing numeric auctionet_id`);
  }

  if (value.model !== EMBEDDING_MODEL) {
    throw new Error(`${filePath} model is ${String(value.model)}, expected ${EMBEDDING_MODEL}`);
  }

  if (value.dimensions !== EMBEDDING_DIMENSIONS) {
    throw new Error(`${filePath} dimensions is ${String(value.dimensions)}, expected ${EMBEDDING_DIMENSIONS}`);
  }

  if (!Array.isArray(value.references)) {
    throw new Error(`${filePath} is missing references array`);
  }

  return {
    auctionet_id: value.auctionet_id,
    source_url: typeof value.source_url === "string" ? value.source_url : null,
    title: typeof value.title === "string" ? value.title : null,
    embedded_at: typeof value.embedded_at === "string" ? value.embedded_at : "",
    model: value.model,
    dimensions: value.dimensions,
    references: value.references.map((reference, index) => validateReference(reference, filePath, index)),
  };
}

function parsePrice(value: unknown, filePath: string) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error(`${filePath} price must be a string or null`);
  }

  const match = /^([\d\s,.]+)\s+([A-Z]{3})$/.exec(value);
  if (!match) {
    throw new Error(`${filePath} price has unsupported format: ${value}`);
  }

  const amount = Number(match[1].replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(amount)) {
    throw new Error(`${filePath} price is not numeric: ${value}`);
  }

  return amount;
}

function validateAuctionetItem(value: unknown, filePath: string): AuctionetItemJson {
  if (!isRecord(value)) {
    throw new Error(`${filePath} must contain a JSON object`);
  }

  if (typeof value.auctionet_id !== "number") {
    throw new Error(`${filePath} is missing numeric auctionet_id`);
  }

  const currency = typeof value.currency === "string" && value.currency.length > 0 ? value.currency : "SEK";

  return {
    auctionet_id: value.auctionet_id,
    source_url: typeof value.source_url === "string" ? value.source_url : null,
    title: typeof value.title === "string" ? value.title : null,
    price: parsePrice(value.price, filePath),
    currency,
  };
}

async function readJson(filePath: string) {
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}

async function readVectorArtifact(filePath: string) {
  return validateVectorArtifact(await readJson(filePath), filePath);
}

async function readAuctionetItem(filePath: string) {
  return validateAuctionetItem(await readJson(filePath), filePath);
}

function getItemPath(artifactPath: string, vectorsDir: string, itemsDir: string) {
  return path.join(itemsDir, path.relative(vectorsDir, artifactPath));
}

function getPointId(auctionetId: number, imageIndex: number) {
  return auctionetId * MAX_REFERENCES_PER_ITEM + imageIndex;
}

function formatDuration(ms: number) {
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

// Rolling window so the estimate adapts when the run transitions between
// fast skips (resume) and slow uploads.
function createProgressTracker(totalItems: number, windowSize = 50) {
  const recentDurations: number[] = [];
  let processed = 0;

  return {
    record(durationMs: number) {
      processed += 1;
      recentDurations.push(durationMs);
      if (recentDurations.length > windowSize) {
        recentDurations.shift();
      }
    },
    report() {
      const averageMs = recentDurations.reduce((sum, value) => sum + value, 0) / recentDurations.length;
      const remaining = totalItems - processed;
      const etaMs = averageMs * remaining;

      return `progress: ${processed}/${totalItems} artifacts, last ${formatDuration(
        recentDurations[recentDurations.length - 1],
      )}, avg ${formatDuration(averageMs)}, ETA ${formatDuration(etaMs)}`;
    },
  };
}

function chunk<T>(values: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

function buildPoints(artifact: VectorArtifact, item: AuctionetItemJson): ReferencePoint[] {
  if (artifact.auctionet_id !== item.auctionet_id) {
    throw new Error(`auctionet_id mismatch: artifact ${artifact.auctionet_id}, item ${item.auctionet_id}`);
  }

  return artifact.references.map((reference) => ({
    id: getPointId(artifact.auctionet_id, reference.image_index),
    vector: reference.embedding,
    payload: {
      auctionet_id: String(artifact.auctionet_id),
      image_index: reference.image_index,
      image_url: reference.image_url,
      title: item.title ?? artifact.title ?? "",
      price: item.price,
      currency: item.currency,
      source_url: item.source_url ?? artifact.source_url ?? "",
    },
  }));
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

  return { size, distance };
}

async function validateCollectionConfig(client: QdrantClient) {
  const vectorParams = getAnonymousVectorParams(await client.getCollection(COLLECTION_NAME));

  if (!vectorParams) {
    throw new Error(`${COLLECTION_NAME} collection must use an anonymous dense vector`);
  }

  if (vectorParams.size !== EMBEDDING_DIMENSIONS || vectorParams.distance.toLowerCase() !== "cosine") {
    throw new Error(
      `${COLLECTION_NAME} collection has ${vectorParams.size}/${vectorParams.distance}, expected ${EMBEDDING_DIMENSIONS}/Cosine. Re-run with --recreate to rebuild it.`,
    );
  }
}

async function ensureCollection(client: QdrantClient, options: Pick<CliOptions, "recreate">) {
  const collectionConfig = {
    vectors: {
      size: EMBEDDING_DIMENSIONS,
      distance: "Cosine",
    },
  } as const;

  if (options.recreate) {
    await client.recreateCollection(COLLECTION_NAME, collectionConfig);
    await validateCollectionConfig(client);
    console.log(`recreated collection: ${COLLECTION_NAME}`);
    return;
  }

  const { exists } = await client.collectionExists(COLLECTION_NAME);
  if (exists) {
    await validateCollectionConfig(client);
    console.log(`collection exists: ${COLLECTION_NAME}`);
    return;
  }

  await client.createCollection(COLLECTION_NAME, collectionConfig);
  await validateCollectionConfig(client);
  console.log(`created collection: ${COLLECTION_NAME}`);
}

async function artifactAlreadySeeded(client: QdrantClient, pointIds: number[]) {
  if (pointIds.length === 0) {
    return true;
  }

  const records = await client.retrieve(COLLECTION_NAME, {
    ids: pointIds,
    with_payload: false,
    with_vector: false,
  });

  return records.length === pointIds.length;
}

async function seedArtifact(
  artifactPath: string,
  vectorsDir: string,
  itemsDir: string,
  options: CliOptions,
  client: QdrantClient | null,
): Promise<{ referenceCount: number; skipped: boolean }> {
  const relativeArtifactPath = path.relative(process.cwd(), artifactPath);
  const artifact = await readVectorArtifact(artifactPath);
  const item = await readAuctionetItem(getItemPath(artifactPath, vectorsDir, itemsDir));
  const points = buildPoints(artifact, item);

  if (options.dryRun) {
    console.log(`seed: ${relativeArtifactPath} (${points.length} references)`);
    return { referenceCount: points.length, skipped: false };
  }

  if (!client) {
    throw new Error("Qdrant client is required outside dry-run mode");
  }

  if (!options.force && (await artifactAlreadySeeded(client, points.map((point) => point.id)))) {
    console.log(`skip existing: ${relativeArtifactPath}`);
    return { referenceCount: 0, skipped: true };
  }

  for (const pointBatch of chunk(points, options.batchSize)) {
    await client.upsert(COLLECTION_NAME, {
      wait: true,
      points: pointBatch,
    });
  }

  console.log(`seeded: ${relativeArtifactPath} (${points.length} references)`);
  return { referenceCount: points.length, skipped: false };
}

async function seedReferences(options: CliOptions, client: QdrantClient | null) {
  const vectorsDir = path.resolve(options.vectorsDir);
  const itemsDir = path.resolve(options.itemsDir);
  let selectedArtifactFiles = await discoverJsonFiles(vectorsDir);
  if (options.reverse) {
    selectedArtifactFiles.reverse();
  }
  if (options.maxItems !== null) {
    selectedArtifactFiles = selectedArtifactFiles.slice(0, options.maxItems);
  }
  const summary: Summary = {
    uploaded: 0,
    skipped: 0,
    failed: 0,
    references: 0,
  };

  if (options.dryRun) {
    console.log(
      options.recreate
        ? `would recreate collection: ${COLLECTION_NAME}`
        : `would ensure collection: ${COLLECTION_NAME}`,
    );
  } else if (client) {
    await ensureCollection(client, options);
  }

  const tracker = createProgressTracker(selectedArtifactFiles.length);

  for (const artifactPath of selectedArtifactFiles) {
    const startedAt = performance.now();
    let uploaded = false;

    try {
      const result = await seedArtifact(artifactPath, vectorsDir, itemsDir, options, client);
      if (result.skipped) {
        summary.skipped += 1;
      } else {
        summary.uploaded += 1;
        uploaded = true;
      }
      summary.references += result.referenceCount;
    } catch (error) {
      summary.failed += 1;
      console.error(
        `failed: ${path.relative(process.cwd(), artifactPath)}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    tracker.record(performance.now() - startedAt);

    if (!options.dryRun && uploaded) {
      console.log(tracker.report());
    }
  }

  return summary;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const client = options.dryRun ? null : (await import("../lib/qdrant")).qdrantClient;
  const summary = await seedReferences(options, client);

  console.log(
    `Summary: uploaded ${summary.uploaded}, skipped ${summary.skipped}, failed ${summary.failed}, references ${summary.references}`,
  );

  if (summary.failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  console.error(usage());
  process.exitCode = 1;
});
