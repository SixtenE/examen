import "dotenv/config";

import { constants } from "node:fs";
import {
  access,
  mkdir,
  readdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expectedPointIds, referenceCollection } from "../lib/catalog-paths";
import { formatDuration } from "../lib/format-duration";
import { setTimeout as sleep } from "node:timers/promises";
import sharp from "sharp";

type CliOptions = {
  itemsDir: string;
  outDir: string;
  batchSize: number;
  delayMs: number;
  maxRetries: number;
  force: boolean;
  skipIndexed: boolean;
  dryRun: boolean;
  maxItems: number | null;
  itemFiles?: string[];
};

type AuctionetItemJson = {
  auctionet_id: number;
  source_url?: string | null;
  title?: string | null;
  status: string | null;
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
  unsold: number;
  failed: number;
  images: number;
  elapsedMs: number;
};

const CATEGORY_SEGMENT_PATTERN = /^\d+-[a-z0-9-]+$/;
const DEFAULT_BATCH_SIZE = 5;
const DEFAULT_DELAY_MS = 1000;
const DEFAULT_MAX_RETRIES = 5;
const EMBEDDING_MODEL = "google/gemini-embedding-2";
const EMBEDDING_DIMENSIONS = 3072;
const OPENROUTER_EMBEDDINGS_URL = "https://openrouter.ai/api/v1/embeddings";
const MAX_EMBEDDING_REQUEST_BYTES = 50 * 1024 * 1024;

function usage() {
  return [
    "Usage: pnpm embed -- --items <dir> --out <dir> [options]",
    "",
    "Options:",
    "  --items <dir>          Per-category Auctionet Item directory (required)",
    "  --out <dir>            Matching per-category Vector Artifact directory (required)",
    `  --batch-size <n>       Image URLs per OpenRouter request (default: ${DEFAULT_BATCH_SIZE})`,
    `  --delay-ms <ms>        Delay between OpenRouter requests (default: ${DEFAULT_DELAY_MS})`,
    `  --max-retries <n>      Retries for 429/5xx responses (default: ${DEFAULT_MAX_RETRIES})`,
    "  --max-items <n>        Embed at most n items (existing/unsold items do not count)",
    "  --force                Regenerate existing vector files",
    "  --skip-indexed         Skip items already in Qdrant (requires existing collections)",
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

function categorySegment(dir: string, flag: string) {
  const segment = path.basename(path.resolve(dir));

  if (!CATEGORY_SEGMENT_PATTERN.test(segment)) {
    throw new Error(
      `${flag} must end with an Auctionet Category segment like 9-ceramics-porcelain, got ${segment}`,
    );
  }

  return segment;
}

export function parseArgs(args: string[]): CliOptions {
  let itemsDir: string | null = null;
  let outDir: string | null = null;
  let batchSize = DEFAULT_BATCH_SIZE;
  let delayMs = DEFAULT_DELAY_MS;
  let maxRetries = DEFAULT_MAX_RETRIES;
  let force = false;
  let skipIndexed = false;
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
        batchSize = parsePositiveInteger(
          readOptionValue(args, index, arg),
          arg,
        );
        index += 1;
        break;
      case "--delay-ms":
        delayMs = parseNonNegativeInteger(
          readOptionValue(args, index, arg),
          arg,
        );
        index += 1;
        break;
      case "--max-retries":
        maxRetries = parseNonNegativeInteger(
          readOptionValue(args, index, arg),
          arg,
        );
        index += 1;
        break;
      case "--max-items":
        maxItems = parsePositiveInteger(readOptionValue(args, index, arg), arg);
        index += 1;
        break;
      case "--skip-indexed":
        skipIndexed = true;
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

  if (!itemsDir) {
    throw new Error("Missing required option: --items");
  }

  if (!outDir) {
    throw new Error("Missing required option: --out");
  }

  const itemsCategory = categorySegment(itemsDir, "--items");
  const outCategory = categorySegment(
    path.dirname(path.resolve(outDir)),
    "--out",
  );

  if (itemsCategory !== outCategory) {
    throw new Error(
      `--items (${itemsCategory}) and --out (${outCategory}) must be the same Auctionet Category`,
    );
  }

  return {
    itemsDir,
    outDir,
    batchSize,
    delayMs,
    maxRetries,
    force,
    skipIndexed,
    dryRun,
    maxItems,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateAuctionetItem(
  value: unknown,
  filePath: string,
): AuctionetItemJson {
  if (!isRecord(value)) {
    throw new Error(`${filePath} must contain a JSON object`);
  }

  if (typeof value.auctionet_id !== "number") {
    throw new Error(`${filePath} is missing numeric auctionet_id`);
  }

  if (
    !Array.isArray(value.image_urls) ||
    !value.image_urls.every((url) => typeof url === "string")
  ) {
    throw new Error(`${filePath} is missing image_urls string array`);
  }

  return {
    auctionet_id: value.auctionet_id,
    source_url: typeof value.source_url === "string" ? value.source_url : null,
    title: typeof value.title === "string" ? value.title : null,
    status: typeof value.status === "string" ? value.status : null,
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

async function discoverItemFiles(
  itemsDir: string,
  skipDir: string,
): Promise<string[]> {
  const entries = await readdir(itemsDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(itemsDir, entry.name);

    if (entry.isDirectory()) {
      if (path.resolve(entryPath) === skipDir) {
        continue;
      }

      files.push(...(await discoverItemFiles(entryPath, skipDir)));
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
    throw new Error(
      `Embedding response returned ${body.data.length} vectors for ${expectedCount} inputs`,
    );
  }

  return body.data.map((entry, index) => {
    if (!isRecord(entry) || !Array.isArray(entry.embedding)) {
      throw new Error(`Embedding response missing vector at index ${index}`);
    }

    if (!entry.embedding.every((value) => typeof value === "number")) {
      throw new Error(
        `Embedding response vector at index ${index} contains non-numeric values`,
      );
    }

    if (entry.embedding.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(
        `Embedding response vector at index ${index} has ${entry.embedding.length} dimensions, expected ${EMBEDDING_DIMENSIONS}`,
      );
    }

    return entry.embedding;
  });
}

async function prepareInlineImages(imageUrls: string[]) {
  return Promise.all(
    imageUrls.map(async (url) => {
      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok) {
          throw new Error(`Image download failed (${response.status})`);
        }
        const bytes = Buffer.from(await response.arrayBuffer());
        const image = sharp(bytes);
        const { format } = await image.metadata();
        // Decode fully; keep JPEG/PNG bytes to avoid inflating large photos.
        await image.stats();
        const supported = format === "jpeg" || format === "png";
        const data = supported ? bytes : await image.png().toBuffer();
        const mime = supported ? format : "png";
        return `data:image/${mime};base64,${data.toString("base64")}`;
      } catch (error) {
        throw new Error(
          `Cannot prepare embedding image ${url}: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }
    }),
  );
}

async function embedImageUrlBatch(
  imageUrls: string[],
  options: Pick<CliOptions, "maxRetries">,
  inlineUrls?: string[],
): Promise<number[][]> {
  const inputUrls = inlineUrls ?? imageUrls;
  const requestBody = JSON.stringify({
    model: EMBEDDING_MODEL,
    input: inputUrls.map((imageUrl) => ({
      content: [{ type: "image_url", image_url: { url: imageUrl } }],
    })),
    encoding_format: "float",
    dimensions: EMBEDDING_DIMENSIONS,
  });
  const requestBytes = Buffer.byteLength(requestBody);
  const splitBatch = async () => {
    if (imageUrls.length === 1) {
      throw new Error(
        `Embedding image exceeds the OpenRouter request size limit (${requestBytes} bytes): ${imageUrls[0]}`,
      );
    }
    const middle = Math.ceil(imageUrls.length / 2);
    console.warn(
      `Splitting embedding batch of ${imageUrls.length} images to fit the request size limit`,
    );
    const first = await embedImageUrlBatch(
      imageUrls.slice(0, middle),
      options,
      inlineUrls?.slice(0, middle),
    );
    const second = await embedImageUrlBatch(
      imageUrls.slice(middle),
      options,
      inlineUrls?.slice(middle),
    );
    return [...first, ...second];
  };
  if (requestBytes > MAX_EMBEDDING_REQUEST_BYTES) return splitBatch();

  for (let attempt = 0; attempt <= options.maxRetries; attempt += 1) {
    let response: Response;

    try {
      response = await fetch(OPENROUTER_EMBEDDINGS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: requestBody,
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

    const errorMessage = formatOpenRouterError(body);
    if (response.status === 413) return splitBatch();
    if (
      !inlineUrls &&
      response.status === 400 &&
      errorMessage.includes("Provided image is not valid")
    ) {
      console.warn(
        "OpenRouter rejected image URLs; retrying with validated inline images",
      );
      return embedImageUrlBatch(
        imageUrls,
        options,
        await prepareInlineImages(imageUrls),
      );
    }

    if (!isRetryableStatus(response.status) || attempt === options.maxRetries) {
      throw new Error(
        `OpenRouter embedding request failed (${response.status}): ${errorMessage}; images: ${imageUrls.join(", ")}`,
      );
    }

    const backoffMs = getBackoffMs(
      attempt,
      response.headers.get("retry-after"),
    );
    console.warn(
      `OpenRouter returned ${response.status}; retrying in ${backoffMs}ms`,
    );
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

export async function embedAuctionetItem(
  item: AuctionetItemJson,
  options: {
    batchSize?: number;
    delayMs?: number;
    maxRetries?: number;
    onProgress?: (message: string) => void;
  } = {},
): Promise<VectorArtifact> {
  if (!process.env.OPENROUTER_API_KEY)
    throw new Error("OPENROUTER_API_KEY must be set");
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const references: ReferenceVector[] = [];
  let imageOffset = 0;

  for (const imageUrlBatch of chunk(item.image_urls, batchSize)) {
    options.onProgress?.(
      `Embedding images ${imageOffset + 1}–${imageOffset + imageUrlBatch.length}/${item.image_urls.length}`,
    );
    const embeddings = await embedImageUrlBatch(imageUrlBatch, { maxRetries });

    for (let index = 0; index < imageUrlBatch.length; index += 1) {
      const imageUrl = imageUrlBatch[index];

      references.push({
        image_index: imageOffset + index,
        image_url: imageUrl,
        embedding: embeddings[index],
      });
    }

    imageOffset += imageUrlBatch.length;

    if (delayMs > 0) {
      await sleep(delayMs);
    }
  }

  return {
    auctionet_id: item.auctionet_id,
    source_url: item.source_url ?? null,
    title: item.title ?? null,
    embedded_at: new Date().toISOString(),
    model: EMBEDDING_MODEL,
    dimensions: EMBEDDING_DIMENSIONS,
    references,
  };
}

export async function embedItem(
  itemPath: string,
  outputPath: string,
  options: CliOptions,
): Promise<{
  imageCount: number;
  skipped: boolean;
  unsold: boolean;
  message: string;
}> {
  const relativeItemPath = path.relative(process.cwd(), itemPath);
  const relativeOutputPath = path.relative(process.cwd(), outputPath);
  const item = await readAuctionetItem(itemPath);

  if (item.status !== "sold") {
    return {
      imageCount: 0,
      skipped: false,
      unsold: true,
      message: `skip unsold: ${relativeItemPath} (status: ${item.status ?? "missing"})`,
    };
  }

  if (!options.force && (await fileExists(outputPath))) {
    return {
      imageCount: 0,
      skipped: true,
      unsold: false,
      message: `skip existing: ${relativeOutputPath}`,
    };
  }

  if (options.dryRun) {
    return {
      imageCount: item.image_urls.length,
      skipped: false,
      unsold: false,
      message: `embed: ${relativeItemPath} -> ${relativeOutputPath} (${item.image_urls.length} images)`,
    };
  }

  if (options.skipIndexed && !options.force) {
    const { qdrantClient } = await import("../lib/qdrant");
    const ids = expectedPointIds(item.auctionet_id, item.image_urls.length);
    const records =
      ids.length === 0
        ? []
        : await qdrantClient.retrieve(
            referenceCollection(categorySegment(options.itemsDir, "--items")),
            { ids, with_payload: false, with_vector: false },
          );
    if (records.length === ids.length) {
      return {
        imageCount: 0,
        skipped: true,
        unsold: false,
        message: `skip indexed: ${relativeItemPath}`,
      };
    }
  }

  const artifact = await embedAuctionetItem(item, options);

  await writeJsonAtomically(outputPath, artifact);

  return {
    imageCount: artifact.references.length,
    skipped: false,
    unsold: false,
    message: `wrote: ${relativeOutputPath} (${artifact.references.length} images)`,
  };
}

export async function embedAuctionetVectors(options: CliOptions) {
  if (!options.dryRun && !process.env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY must be set");
  }

  const itemsDir = path.resolve(options.itemsDir);
  const outDir = path.resolve(options.outDir);
  const startedAt = Date.now();
  const itemFiles =
    options.itemFiles ?? (await discoverItemFiles(itemsDir, outDir));
  const summary: Summary = {
    embedded: 0,
    skipped: 0,
    unsold: 0,
    failed: 0,
    images: 0,
    elapsedMs: 0,
  };

  const pending: string[] = [];
  for (const itemPath of itemFiles) {
    let item: AuctionetItemJson;
    try {
      item = await readAuctionetItem(itemPath);
    } catch {
      pending.push(itemPath);
      continue;
    }

    if (item.status !== "sold") {
      summary.unsold += 1;
    } else if (
      !options.force &&
      (await fileExists(getOutputPath(itemPath, itemsDir, outDir)))
    ) {
      summary.skipped += 1;
    } else {
      pending.push(itemPath);
    }
  }

  console.log(
    `embed ${path.basename(itemsDir)}: ${itemFiles.length} items -> ${pending.length} to embed (${summary.unsold} unsold, ${summary.skipped} existing)${
      options.maxItems === null ? "" : `, limit ${options.maxItems}`
    }`,
  );

  const loopStartedAt = Date.now();
  let processed = 0;
  let quickSkips = 0;

  for (const itemPath of pending) {
    if (
      options.maxItems !== null &&
      summary.embedded + summary.failed >= options.maxItems
    )
      break;
    const outputPath = getOutputPath(itemPath, itemsDir, outDir);
    const itemStartedAt = Date.now();
    let line: string;
    let failed = false;

    try {
      const result = await embedItem(itemPath, outputPath, options);
      if (result.unsold) {
        summary.unsold += 1;
        quickSkips += 1;
      } else if (result.skipped) {
        summary.skipped += 1;
        quickSkips += 1;
      } else {
        summary.embedded += 1;
      }
      summary.images += result.imageCount;
      line =
        result.skipped || result.unsold
          ? result.message
          : `${result.message} ${formatDuration(Date.now() - itemStartedAt)}`;
    } catch (error) {
      summary.failed += 1;
      failed = true;
      line = `failed: ${path.relative(process.cwd(), itemPath)}: ${
        error instanceof Error ? error.message : String(error)
      }`;
    }

    processed += 1;
    // Skips found during the loop don't use up the --max-items budget.
    const total = Math.min(
      pending.length,
      (options.maxItems ?? Infinity) + quickSkips,
    );
    const worked = summary.embedded + summary.failed;
    const elapsedMs = Date.now() - loopStartedAt;
    const eta =
      worked === 0
        ? "--"
        : formatDuration((total - processed) * (elapsedMs / worked));
    const width = String(total).length;
    const percent = Math.floor((processed / total) * 100);
    const status = `[${String(processed).padStart(width)}/${total} ${String(percent).padStart(3)}%] ${line} | elapsed ${formatDuration(elapsedMs)} | ETA ${eta}`;

    if (failed) {
      console.error(status);
    } else {
      console.log(status);
    }
  }

  summary.elapsedMs = Date.now() - startedAt;
  return summary;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const summary = await embedAuctionetVectors(options);

  console.log(
    `Summary: embedded ${summary.embedded}, skipped ${summary.skipped}, unsold ${summary.unsold}, failed ${summary.failed}, images ${summary.images} in ${formatDuration(summary.elapsedMs)}`,
  );

  if (summary.failed > 0) {
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    console.error(usage());
    process.exitCode = 1;
  });
}
