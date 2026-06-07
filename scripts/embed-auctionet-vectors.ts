import "dotenv/config";

import { constants } from "node:fs";
import { access, mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

type CliOptions = {
  itemsDir: string;
  outDir: string;
  batchSize: number;
  delayMs: number;
  maxRetries: number;
  force: boolean;
  dryRun: boolean;
  maxItems: number | null;
};

type AuctionetItemJson = {
  auctionet_id: number;
  source_url?: string | null;
  title?: string | null;
  image_urls: string[];
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

type Summary = {
  embedded: number;
  skipped: number;
  failed: number;
  images: number;
};

const DEFAULT_ITEMS_DIR = "data/auctionet/items";
const DEFAULT_OUT_DIR = "data/auctionet/vectors";
const DEFAULT_BATCH_SIZE = 5;
const DEFAULT_DELAY_MS = 1000;
const DEFAULT_MAX_RETRIES = 5;
const EMBEDDING_MODEL = "google/gemini-embedding-2";
const EMBEDDING_DIMENSIONS = 3072;
const OPENROUTER_EMBEDDINGS_URL = "https://openrouter.ai/api/v1/embeddings";

function usage() {
  return [
    "Usage: pnpm embed:auctionet-vectors -- [options]",
    "",
    "Options:",
    `  --items <dir>          Auctionet Item JSON directory (default: ${DEFAULT_ITEMS_DIR})`,
    `  --out <dir>            Vector output directory (default: ${DEFAULT_OUT_DIR})`,
    `  --batch-size <n>       Image URLs per OpenRouter request (default: ${DEFAULT_BATCH_SIZE})`,
    `  --delay-ms <ms>        Delay between OpenRouter requests (default: ${DEFAULT_DELAY_MS})`,
    `  --max-retries <n>      Retries for 429/5xx responses (default: ${DEFAULT_MAX_RETRIES})`,
    "  --max-items <n>        Stop after processing n item files",
    "  --force                Regenerate existing vector files",
    "  --dry-run              Print planned work without calling OpenRouter or writing files",
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

function parseNonNegativeInteger(value: string, name: string) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }

  return parsed;
}

function parseArgs(args: string[]): CliOptions {
  let itemsDir = DEFAULT_ITEMS_DIR;
  let outDir = DEFAULT_OUT_DIR;
  let batchSize = DEFAULT_BATCH_SIZE;
  let delayMs = DEFAULT_DELAY_MS;
  let maxRetries = DEFAULT_MAX_RETRIES;
  let force = false;
  let dryRun = false;
  let maxItems: number | null = null;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    switch (arg) {
      case "--":
        break;
      case "--items":
        itemsDir = readOptionValue(args, index, arg);
        index += 1;
        break;
      case "--out":
        outDir = readOptionValue(args, index, arg);
        index += 1;
        break;
      case "--batch-size":
        batchSize = parsePositiveInteger(readOptionValue(args, index, arg), arg);
        index += 1;
        break;
      case "--delay-ms":
        delayMs = parseNonNegativeInteger(readOptionValue(args, index, arg), arg);
        index += 1;
        break;
      case "--max-retries":
        maxRetries = parseNonNegativeInteger(readOptionValue(args, index, arg), arg);
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
      case "--help":
      case "-h":
        console.log(usage());
        process.exit(0);
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return {
    itemsDir,
    outDir,
    batchSize,
    delayMs,
    maxRetries,
    force,
    dryRun,
    maxItems,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateAuctionetItem(value: unknown, filePath: string): AuctionetItemJson {
  if (!isRecord(value)) {
    throw new Error(`${filePath} must contain a JSON object`);
  }

  if (typeof value.auctionet_id !== "number") {
    throw new Error(`${filePath} is missing numeric auctionet_id`);
  }

  if (!Array.isArray(value.image_urls) || !value.image_urls.every((url) => typeof url === "string")) {
    throw new Error(`${filePath} is missing image_urls string array`);
  }

  return {
    auctionet_id: value.auctionet_id,
    source_url: typeof value.source_url === "string" ? value.source_url : null,
    title: typeof value.title === "string" ? value.title : null,
    image_urls: value.image_urls,
  };
}

async function fileExists(filePath: string) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function discoverItemFiles(itemsDir: string): Promise<string[]> {
  const entries = await readdir(itemsDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(itemsDir, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await discoverItemFiles(entryPath)));
      continue;
    }

    if (entry.isFile() && /^\d+\.json$/.test(entry.name)) {
      files.push(entryPath);
    }
  }

  return files.sort();
}

function getOutputPath(itemPath: string, itemsDir: string, outDir: string) {
  return path.join(outDir, path.relative(itemsDir, itemPath));
}

function chunk<T>(values: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

function parseRetryAfter(value: string | null) {
  if (!value) {
    return null;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }

  const dateMs = Date.parse(value);
  if (Number.isFinite(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }

  return null;
}

function isRetryableStatus(status: number) {
  return status === 429 || (status >= 500 && status < 600);
}

function getBackoffMs(attempt: number, retryAfter: string | null) {
  const retryAfterMs = parseRetryAfter(retryAfter);
  if (retryAfterMs !== null) {
    return retryAfterMs;
  }

  return Math.min(30_000, 1000 * 2 ** attempt);
}

async function parseResponseBody(response: Response) {
  const text = await response.text();

  if (text.length === 0) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function formatOpenRouterError(body: unknown) {
  if (isRecord(body) && "error" in body) {
    return JSON.stringify(body.error);
  }

  return typeof body === "string" ? body : JSON.stringify(body);
}

function extractEmbeddings(body: unknown, expectedCount: number) {
  if (!isRecord(body) || !Array.isArray(body.data)) {
    throw new Error("Embedding response missing data array");
  }

  if (body.data.length !== expectedCount) {
    throw new Error(`Embedding response returned ${body.data.length} vectors for ${expectedCount} inputs`);
  }

  return body.data.map((entry, index) => {
    if (!isRecord(entry) || !Array.isArray(entry.embedding)) {
      throw new Error(`Embedding response missing vector at index ${index}`);
    }

    if (!entry.embedding.every((value) => typeof value === "number")) {
      throw new Error(`Embedding response vector at index ${index} contains non-numeric values`);
    }

    if (entry.embedding.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(
        `Embedding response vector at index ${index} has ${entry.embedding.length} dimensions, expected ${EMBEDDING_DIMENSIONS}`,
      );
    }

    return entry.embedding;
  });
}

async function embedImageUrlBatch(imageUrls: string[], options: Pick<CliOptions, "maxRetries">) {
  for (let attempt = 0; attempt <= options.maxRetries; attempt += 1) {
    let response: Response;

    try {
      response = await fetch(OPENROUTER_EMBEDDINGS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: EMBEDDING_MODEL,
          input: imageUrls.map((imageUrl) => ({
            content: [
              {
                type: "image_url",
                image_url: {
                  url: imageUrl,
                },
              },
            ],
          })),
          encoding_format: "float",
          dimensions: EMBEDDING_DIMENSIONS,
        }),
      });
    } catch (error) {
      if (attempt === options.maxRetries) {
        throw error;
      }

      const backoffMs = getBackoffMs(attempt, null);
      console.warn(
        `OpenRouter request errored; retrying in ${backoffMs}ms: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      await sleep(backoffMs);
      continue;
    }

    const body = await parseResponseBody(response);

    if (response.ok) {
      return extractEmbeddings(body, imageUrls.length);
    }

    if (!isRetryableStatus(response.status) || attempt === options.maxRetries) {
      throw new Error(
        `OpenRouter embedding request failed (${response.status}): ${formatOpenRouterError(body)}`,
      );
    }

    const backoffMs = getBackoffMs(attempt, response.headers.get("retry-after"));
    console.warn(`OpenRouter returned ${response.status}; retrying in ${backoffMs}ms`);
    await sleep(backoffMs);
  }

  throw new Error("OpenRouter embedding request exhausted retries");
}

async function readAuctionetItem(itemPath: string) {
  const raw = await readFile(itemPath, "utf8");
  return validateAuctionetItem(JSON.parse(raw) as unknown, itemPath);
}

async function writeJsonAtomically(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });

  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`);
  await rename(tempPath, filePath);
}

async function embedItem(
  itemPath: string,
  outputPath: string,
  options: CliOptions,
): Promise<{ imageCount: number; skipped: boolean }> {
  const relativeOutputPath = path.relative(process.cwd(), outputPath);

  if (!options.force && (await fileExists(outputPath))) {
    console.log(`skip existing: ${relativeOutputPath}`);
    return { imageCount: 0, skipped: true };
  }

  const item = await readAuctionetItem(itemPath);

  if (options.dryRun) {
    console.log(`embed: ${path.relative(process.cwd(), itemPath)} -> ${relativeOutputPath} (${item.image_urls.length} images)`);
    return { imageCount: item.image_urls.length, skipped: false };
  }

  const references: ReferenceVector[] = [];
  let imageOffset = 0;

  for (const imageUrlBatch of chunk(item.image_urls, options.batchSize)) {
    const embeddings = await embedImageUrlBatch(imageUrlBatch, options);

    for (let index = 0; index < imageUrlBatch.length; index += 1) {
      const imageUrl = imageUrlBatch[index];

      references.push({
        image_index: imageOffset + index,
        image_url: imageUrl,
        embedding: embeddings[index],
      });
    }

    imageOffset += imageUrlBatch.length;

    if (options.delayMs > 0) {
      await sleep(options.delayMs);
    }
  }

  const artifact: VectorArtifact = {
    auctionet_id: item.auctionet_id,
    source_url: item.source_url ?? null,
    title: item.title ?? null,
    embedded_at: new Date().toISOString(),
    model: EMBEDDING_MODEL,
    dimensions: EMBEDDING_DIMENSIONS,
    references,
  };

  await writeJsonAtomically(outputPath, artifact);
  console.log(`wrote: ${relativeOutputPath} (${references.length} images)`);

  return { imageCount: references.length, skipped: false };
}

async function embedAuctionetVectors(options: CliOptions) {
  if (!options.dryRun && !process.env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY must be set");
  }

  const itemsDir = path.resolve(options.itemsDir);
  const outDir = path.resolve(options.outDir);
  const itemFiles = await discoverItemFiles(itemsDir);
  const selectedItemFiles = options.maxItems === null ? itemFiles : itemFiles.slice(0, options.maxItems);
  const summary: Summary = {
    embedded: 0,
    skipped: 0,
    failed: 0,
    images: 0,
  };

  for (const itemPath of selectedItemFiles) {
    const outputPath = getOutputPath(itemPath, itemsDir, outDir);

    try {
      const result = await embedItem(itemPath, outputPath, options);
      if (result.skipped) {
        summary.skipped += 1;
      } else {
        summary.embedded += 1;
      }
      summary.images += result.imageCount;
    } catch (error) {
      summary.failed += 1;
      console.error(
        `failed: ${path.relative(process.cwd(), itemPath)}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  return summary;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const summary = await embedAuctionetVectors(options);

  console.log(
    `Summary: embedded ${summary.embedded}, skipped ${summary.skipped}, failed ${summary.failed}, images ${summary.images}`,
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
