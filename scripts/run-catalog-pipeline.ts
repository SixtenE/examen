import "dotenv/config";

import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  categoryBucketPrefix,
  categoryItemsDir,
  categoryVectorsBucketPrefix,
  categoryVectorsDir,
  expectedPointIds,
  localPathToBucketKey,
  parseCatalogCategories,
  type CatalogCategory,
} from "../lib/catalog-paths";

type CliOptions = {
  categories: CatalogCategory[];
  dryRun: boolean;
  skipScrape: boolean;
  skipEmbed: boolean;
  skipSeed: boolean;
  maxPages: number | null;
  maxItems: number | null;
};

type ItemSummary = {
  auctionet_id: number;
  status: string | null;
  image_urls: string[];
};

function usage() {
  return [
    "Usage: pnpm catalog:pipeline -- [options]",
    "",
    "Daily catalog pipeline: scrape → Railway bucket → embed → Qdrant.",
    "Duplicate checks: local item files, bucket HeadObject, vector files, Qdrant point IDs.",
    "",
    "Options:",
    "  --category <segment|url>   Category segment, or segment|url (repeatable)",
    "  --dry-run                  Print planned work without side effects",
    "  --skip-scrape              Skip Auctionet scraping",
    "  --skip-embed               Skip embedding",
    "  --skip-seed                Skip Qdrant seeding",
    "  --max-pages <n>            Forwarded to scrape:auctionet",
    "  --max-items <n>            Forwarded to scrape/embed/seed",
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
  const categoryArgs: string[] = [];
  let dryRun = false;
  let skipScrape = false;
  let skipEmbed = false;
  let skipSeed = false;
  let maxPages: number | null = null;
  let maxItems: number | null = null;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    switch (arg) {
      case "--":
        break;
      case "--category":
        categoryArgs.push(readOptionValue(args, index, arg));
        index += 1;
        break;
      case "--dry-run":
        dryRun = true;
        break;
      case "--skip-scrape":
        skipScrape = true;
        break;
      case "--skip-embed":
        skipEmbed = true;
        break;
      case "--skip-seed":
        skipSeed = true;
        break;
      case "--max-pages":
        maxPages = parsePositiveInteger(readOptionValue(args, index, arg), arg);
        index += 1;
        break;
      case "--max-items":
        maxItems = parsePositiveInteger(readOptionValue(args, index, arg), arg);
        index += 1;
        break;
      case "--help":
      case "-h":
        console.log(usage());
        process.exit(0);
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  const categories =
    categoryArgs.length > 0
      ? parseCatalogCategories(categoryArgs.join(","))
      : parseCatalogCategories(process.env.CATALOG_CATEGORIES);

  return {
    categories,
    dryRun,
    skipScrape,
    skipEmbed,
    skipSeed,
    maxPages,
    maxItems,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function discoverItemFiles(itemsDir: string, vectorsDir: string) {
  if (!(await fileExists(itemsDir))) {
    return [];
  }

  const files: string[] = [];

  async function walk(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (path.resolve(entryPath) === path.resolve(vectorsDir)) {
          continue;
        }

        if (entry.name === "runs") {
          continue;
        }

        await walk(entryPath);
        continue;
      }

      if (entry.isFile() && /^\d+\.json$/.test(entry.name)) {
        files.push(entryPath);
      }
    }
  }

  await walk(itemsDir);
  return files.sort();
}

async function readItemSummary(filePath: string): Promise<ItemSummary> {
  const value = JSON.parse(await readFile(filePath, "utf8")) as unknown;

  if (!isRecord(value) || typeof value.auctionet_id !== "number") {
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
    status: typeof value.status === "string" ? value.status : null,
    image_urls: value.image_urls,
  };
}

function runScript(scriptPath: string, scriptArgs: string[], dryRun: boolean) {
  const command = `tsx ${scriptPath} ${scriptArgs.join(" ")}`;

  if (dryRun) {
    console.log(`dry-run: ${command}`);
    return Promise.resolve(0);
  }

  return new Promise<number>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        path.join("node_modules", "tsx", "dist", "cli.mjs"),
        scriptPath,
        ...scriptArgs,
      ],
      {
        stdio: "inherit",
        env: process.env,
      },
    );

    child.on("error", reject);
    child.on("close", (code) => {
      resolve(code ?? 1);
    });
  });
}

async function artifactAlreadySeeded(
  collectionName: string,
  pointIds: number[],
) {
  if (pointIds.length === 0) {
    return true;
  }

  const { qdrantClient } = await import("../lib/qdrant");
  const records = await qdrantClient.retrieve(collectionName, {
    ids: pointIds,
    with_payload: false,
    with_vector: false,
  });

  return records.length === pointIds.length;
}

async function prepareVectors(category: CatalogCategory, dryRun: boolean) {
  const { catalogObjectExists, downloadCatalogObject } = await import(
    "../lib/catalog-bucket"
  );
  const itemsDir = categoryItemsDir(category.segment);
  const vectorsDir = categoryVectorsDir(category.segment);
  const collectionName = `references-${category.segment}`;
  const itemFiles = await discoverItemFiles(itemsDir, vectorsDir);

  let alreadyInQdrant = 0;
  let downloaded = 0;
  let pendingEmbed = 0;
  let unsold = 0;

  await mkdir(vectorsDir, { recursive: true });

  for (const itemPath of itemFiles) {
    const item = await readItemSummary(itemPath);

    if (item.status !== "sold") {
      unsold += 1;
      continue;
    }

    const relative = path.relative(itemsDir, itemPath);
    const vectorPath = path.join(vectorsDir, relative);
    const vectorKey = localPathToBucketKey(vectorPath);

    if (await fileExists(vectorPath)) {
      continue;
    }

    const pointIds = expectedPointIds(item.auctionet_id, item.image_urls.length);

    if (!dryRun && (await artifactAlreadySeeded(collectionName, pointIds))) {
      alreadyInQdrant += 1;
      console.log(`skip seeded: ${relative}`);
      continue;
    }

    if (dryRun) {
      console.log(`dry-run would fetch or embed vector: ${relative}`);
      pendingEmbed += 1;
      continue;
    }

    if (await catalogObjectExists(vectorKey)) {
      await downloadCatalogObject(vectorKey, vectorPath);
      console.log(`downloaded vector: ${relative}`);
      downloaded += 1;
      continue;
    }

    pendingEmbed += 1;
  }

  return { alreadyInQdrant, downloaded, pendingEmbed, unsold };
}

async function runCategory(category: CatalogCategory, options: CliOptions) {
  const { syncCatalogDirUp, syncCatalogPrefixDown, syncVectorsDirUp } =
    await import("../lib/catalog-bucket");
  const itemsDir = categoryItemsDir(category.segment);
  const vectorsDir = categoryVectorsDir(category.segment);
  const itemsPrefix = categoryBucketPrefix(category.segment);

  console.log(`\n=== ${category.segment} ===`);
  await mkdir(itemsDir, { recursive: true });

  console.log("Syncing Auctionet Item JSON from bucket (skip existing local)...");
  if (options.dryRun) {
    console.log(`dry-run sync down: ${itemsPrefix}`);
  } else {
    const down = await syncCatalogPrefixDown({ prefix: itemsPrefix });
    console.log(
      `bucket → local items: downloaded ${down.downloaded}, skipped ${down.skipped}`,
    );
  }

  if (!options.skipScrape) {
    const scrapeArgs = ["--url", category.url, "--out", itemsDir];
    if (options.maxPages !== null) {
      scrapeArgs.push("--max-pages", String(options.maxPages));
    }
    if (options.maxItems !== null) {
      scrapeArgs.push("--max-items", String(options.maxItems));
    }

    console.log("Scraping Auctionet (skips existing item JSON)...");
    const scrapeCode = await runScript(
      "scripts/scrape-auctionet.ts",
      scrapeArgs,
      options.dryRun,
    );
    if (scrapeCode !== 0) {
      throw new Error(`scrape:auctionet exited with code ${scrapeCode}`);
    }
  }

  console.log("Uploading Auctionet Item JSON to bucket (skip existing remote)...");
  if (options.dryRun) {
    console.log(`dry-run sync up items: ${itemsDir}`);
  } else {
    const up = await syncCatalogDirUp({ localDir: itemsDir });
    console.log(
      `local → bucket items: uploaded ${up.uploaded}, skipped ${up.skipped}`,
    );
  }

  console.log(
    "Preparing Vector Artifacts (skip Qdrant duplicates, reuse bucket vectors)...",
  );
  const prepared = await prepareVectors(category, options.dryRun);
  console.log(
    `prepare vectors: qdrant-skip ${prepared.alreadyInQdrant}, downloaded ${prepared.downloaded}, pending embed ${prepared.pendingEmbed}, unsold ${prepared.unsold}`,
  );

  if (!options.skipEmbed) {
    const embedArgs = ["--items", itemsDir, "--out", vectorsDir];
    if (options.maxItems !== null) {
      embedArgs.push("--max-items", String(options.maxItems));
    }
    if (options.dryRun) {
      embedArgs.push("--dry-run");
    }

    console.log("Embedding images (skips existing Vector Artifacts)...");
    const embedCode = await runScript(
      "scripts/embed-auctionet-vectors.ts",
      embedArgs,
      false,
    );
    if (embedCode !== 0) {
      throw new Error(`embed:auctionet-vectors exited with code ${embedCode}`);
    }
  }

  console.log("Uploading Vector Artifacts to bucket (skip existing remote)...");
  if (options.dryRun) {
    console.log(`dry-run sync up vectors: ${vectorsDir}`);
  } else {
    const up = await syncVectorsDirUp({ vectorsDir });
    console.log(
      `local → bucket vectors: uploaded ${up.uploaded}, skipped ${up.skipped}`,
    );
  }

  if (!options.skipSeed) {
    const seedArgs = ["--vectors", vectorsDir, "--items", itemsDir];
    if (options.maxItems !== null) {
      seedArgs.push("--max-items", String(options.maxItems));
    }
    if (options.dryRun) {
      seedArgs.push("--dry-run");
    }

    console.log("Seeding Qdrant (skips artifacts whose points already exist)...");
    const seedCode = await runScript(
      "scripts/seed-references.ts",
      seedArgs,
      false,
    );
    if (seedCode !== 0) {
      throw new Error(`seed:references exited with code ${seedCode}`);
    }
  }

  console.log(
    `bucket vectors prefix: ${categoryVectorsBucketPrefix(category.segment)}`,
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.categories.length === 0) {
    throw new Error("No Auctionet Categories configured");
  }

  console.log(
    `Catalog pipeline starting for ${options.categories
      .map((category) => category.segment)
      .join(", ")}`,
  );

  for (const category of options.categories) {
    await runCategory(category, options);
  }

  console.log("\nCatalog pipeline finished");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    console.error(usage());
    process.exitCode = 1;
  })
  .finally(async () => {
    // Destroy the S3 client so Railway cron exits instead of hanging on open handles.
    // QdrantClient has no close/destroy API; it uses plain fetch.
    try {
      const { s3Client } = await import("../lib/s3");
      s3Client.destroy();
    } catch {
      // S3 may be unset in dry local exploration.
    }
  });
