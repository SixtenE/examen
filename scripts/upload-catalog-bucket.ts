import "dotenv/config";

import { readdir } from "node:fs/promises";
import path from "node:path";
import {
  assertCategorySegment,
  CATEGORY_SEGMENT_PATTERN,
  categoryItemsDir,
  categoryVectorsDir,
  LOCAL_CATALOG_ROOT,
} from "../lib/catalog-paths";

type CliOptions = {
  categories: string[];
  dryRun: boolean;
  concurrency: number;
};

const DEFAULT_CONCURRENCY = 8;

function usage() {
  return [
    "Usage: pnpm catalog:upload -- [options]",
    "",
    "Upload local Auctionet Item JSON and Vector Artifacts to the Railway Bucket.",
    "Skips keys that already exist (HeadObject). No scrape, embed, Qdrant, or download.",
    "",
    "Options:",
    "  --category <segment>   Auctionet Category segment (repeatable)",
    `  --concurrency <n>      Parallel uploads (default: ${DEFAULT_CONCURRENCY})`,
    "  --dry-run              Print planned work without uploading",
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
  const categories: string[] = [];
  let dryRun = false;
  let concurrency = DEFAULT_CONCURRENCY;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    switch (arg) {
      case "--":
        break;
      case "--category":
        categories.push(
          assertCategorySegment(readOptionValue(args, index, arg)),
        );
        index += 1;
        break;
      case "--concurrency":
        concurrency = parsePositiveInteger(
          readOptionValue(args, index, arg),
          arg,
        );
        index += 1;
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

  return { categories, dryRun, concurrency };
}

async function isFlatCategoryDir(dirPath: string) {
  const entries = await readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    if (
      entry.name === "vectors" ||
      entry.name === "runs" ||
      /^\d+$/.test(entry.name)
    ) {
      continue;
    }

    if (CATEGORY_SEGMENT_PATTERN.test(entry.name)) {
      return false;
    }
  }

  return true;
}

async function discoverFlatCategories() {
  const entries = await readdir(LOCAL_CATALOG_ROOT, { withFileTypes: true });
  const segments: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || !CATEGORY_SEGMENT_PATTERN.test(entry.name)) {
      continue;
    }

    const dirPath = path.join(LOCAL_CATALOG_ROOT, entry.name);

    if (await isFlatCategoryDir(dirPath)) {
      segments.push(entry.name);
    }
  }

  return segments.sort();
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "?";
  }

  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`;
  }

  if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }

  return `${secs}s`;
}

function createProgressReporter(label: string) {
  const startedAt = Date.now();
  let lastLogAt = 0;

  return (done: number, total: number) => {
    const now = Date.now();
    const finished = done >= total;

    if (!finished && now - lastLogAt < 1000 && done !== 1) {
      return;
    }

    lastLogAt = now;
    const elapsedSec = (now - startedAt) / 1000;
    const rate = done > 0 ? done / elapsedSec : 0;
    const etaSec = rate > 0 ? (total - done) / rate : Number.POSITIVE_INFINITY;
    const pct = total === 0 ? 100 : Math.floor((done / total) * 100);

    process.stdout.write(
      `\r${label}: ${done}/${total} (${pct}%) ` +
        `${rate.toFixed(1)}/s ETA ${formatDuration(etaSec)}   `,
    );

    if (finished) {
      process.stdout.write("\n");
    }
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const categories =
    options.categories.length > 0
      ? options.categories
      : await discoverFlatCategories();

  if (categories.length === 0) {
    throw new Error(`No flat Auctionet Category dirs under ${LOCAL_CATALOG_ROOT}`);
  }

  console.log(
    `Uploading categories: ${categories.join(", ")} (concurrency ${options.concurrency})`,
  );

  if (options.dryRun) {
    for (const segment of categories) {
      console.log(`dry-run items: ${categoryItemsDir(segment)}`);
      console.log(`dry-run vectors: ${categoryVectorsDir(segment)}`);
    }
    return;
  }

  const { syncCatalogDirUp, syncVectorsDirUp } = await import(
    "../lib/catalog-bucket"
  );

  for (const segment of categories) {
    const itemsDir = categoryItemsDir(segment);
    const vectorsDir = categoryVectorsDir(segment);

    console.log(`\n=== ${segment} ===`);

    const items = await syncCatalogDirUp({
      localDir: itemsDir,
      concurrency: options.concurrency,
      onProgress: createProgressReporter(`${segment} items`),
    });
    console.log(
      `items: uploaded ${items.uploaded}, skipped ${items.skipped}, total ${items.total}`,
    );

    const vectors = await syncVectorsDirUp({
      vectorsDir,
      concurrency: options.concurrency,
      onProgress: createProgressReporter(`${segment} vectors`),
    });
    console.log(
      `vectors: uploaded ${vectors.uploaded}, skipped ${vectors.skipped}, total ${vectors.total}`,
    );
  }

  console.log("\nCatalog upload finished");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    console.error(usage());
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      const { s3Client } = await import("../lib/s3");
      s3Client.destroy();
    } catch {
      // S3 may be unset in dry local exploration.
    }
  });
