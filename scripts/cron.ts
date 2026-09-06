import "dotenv/config";

import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  discoverCompanyLeafCategories,
  INCREMENTAL_LISTING_ORDER,
  listingOrdersForSegment,
} from "../lib/auctionet-leaves";
import {
  AUCTIONET_LEAF_CATEGORIES,
  categoryBucketPrefix,
  categoryItemsDir,
  categoryVectorsBucketPrefix,
  categoryVectorsDir,
  CRAFOORD_STOCKHOLM_COMPANY_ID,
  expectedPointIds,
  localPathToBucketKey,
  parseCatalogCategories,
  parsePipelineStages,
  referenceCollection,
  type CatalogCategory,
  type PipelineStage,
} from "../lib/catalog-paths";

type PipelineMode = "backfill" | "incremental";

type CliOptions = {
  categories: CatalogCategory[];
  dryRun: boolean;
  force: boolean;
  stages: Set<PipelineStage>;
  maxPages: number | null;
  maxItems: number | null;
  mode: PipelineMode;
  discoverLeaves: boolean;
  companyId: number;
};

type ItemSummary = {
  auctionet_id: number;
  status: string | null;
  image_urls: string[];
};

function usage() {
  return [
    "Usage: pnpm cron -- [options]",
    "",
    "Daily catalog pipeline: scrape → embed → store → upsert.",
    "Duplicate checks: bucket HeadObject (scrape), local/vector files, Qdrant point IDs.",
    "",
    "Options:",
    "  --category <segment|url>   Category segment, or segment|url (repeatable)",
    "  --mode <backfill|incremental>  Scrape strategy (default: backfill)",
    "  --stages <list>            Comma list: scrape,embed,store,upsert (default: all)",
    "  --discover-leaves          Refresh leaf categories from Auctionet facets",
    `  --company-id <n>           Company for --discover-leaves (default: ${CRAFOORD_STOCKHOLM_COMPANY_ID})`,
    "  --dry-run                  Print planned work without side effects",
    "  --force                    Forwarded to upsert (rewrite existing Qdrant payloads)",
    "  --max-pages <n>            Forwarded to scrape",
    "  --max-items <n>            Max newly scraped items across categories (skips excluded)",
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

function parseArgs(args: string[]): Omit<CliOptions, "categories"> & {
  categoryArgs: string[];
} {
  const categoryArgs: string[] = [];
  let dryRun = false;
  let force = false;
  let stages = parsePipelineStages(undefined);
  let maxPages: number | null = null;
  let maxItems: number | null = null;
  let mode: PipelineMode = "backfill";
  let discoverLeaves = false;
  let companyId = CRAFOORD_STOCKHOLM_COMPANY_ID;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    switch (arg) {
      case "--":
        break;
      case "--category":
        categoryArgs.push(readOptionValue(args, index, arg));
        index += 1;
        break;
      case "--mode": {
        const value = readOptionValue(args, index, arg);
        if (value !== "backfill" && value !== "incremental") {
          throw new Error("--mode must be backfill or incremental");
        }
        mode = value;
        index += 1;
        break;
      }
      case "--stages":
        stages = parsePipelineStages(readOptionValue(args, index, arg));
        index += 1;
        break;
      case "--discover-leaves":
        discoverLeaves = true;
        break;
      case "--company-id":
        companyId = parsePositiveInteger(
          readOptionValue(args, index, arg),
          arg,
        );
        index += 1;
        break;
      case "--dry-run":
        dryRun = true;
        break;
      case "--force":
        force = true;
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

  return {
    categoryArgs,
    dryRun,
    force,
    stages,
    maxPages,
    maxItems,
    mode,
    discoverLeaves,
    companyId,
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
    return Promise.resolve({ code: 0, output: "" });
  }

  return new Promise<{ code: number; output: string }>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        path.join("node_modules", "tsx", "dist", "cli.mjs"),
        scriptPath,
        ...scriptArgs,
      ],
      {
        stdio: ["inherit", "pipe", "pipe"],
        env: process.env,
      },
    );

    let output = "";

    child.stdout?.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString();
      output += text;
      process.stdout.write(text);
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString();
      output += text;
      process.stderr.write(text);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code: code ?? 1, output });
    });
  });
}

function parseScrapeSaved(output: string) {
  const matches = [...output.matchAll(/SCRAPE_SAVED=(\d+)/g)];
  if (matches.length === 0) {
    return 0;
  }
  return Number(matches[matches.length - 1][1]);
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

async function prepareVectors(
  category: CatalogCategory,
  dryRun: boolean,
  force: boolean,
) {
  const { catalogObjectExists, downloadCatalogObject } = await import(
    "../lib/catalog-bucket"
  );
  const itemsDir = categoryItemsDir(category.segment);
  const vectorsDir = categoryVectorsDir(category.segment);
  const collectionName = referenceCollection(category.segment);
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

    // Without --force, seeded points need no local Vector Artifact for upsert.
    // With --force, download so upsert can rewrite payloads (e.g. Sold At).
    if (
      !force &&
      !dryRun &&
      (await artifactAlreadySeeded(collectionName, pointIds))
    ) {
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

async function runCategory(
  category: CatalogCategory,
  options: CliOptions,
  scrapeMaxItems: number | null,
) {
  const itemsDir = categoryItemsDir(category.segment);
  const vectorsDir = categoryVectorsDir(category.segment);
  const itemsPrefix = categoryBucketPrefix(category.segment);
  let scrapedSaved = 0;

  console.log(`\n=== ${category.segment} ===`);

  if (options.stages.has("scrape")) {
    if (scrapeMaxItems === 0) {
      console.log("Scrape max-items budget exhausted — skipping scrape");
    } else {
      const scrapeArgs = ["--url", category.url];
      if (options.maxPages !== null) {
        scrapeArgs.push("--max-pages", String(options.maxPages));
      }
      if (scrapeMaxItems !== null) {
        scrapeArgs.push("--max-items", String(scrapeMaxItems));
      }

      if (options.mode === "incremental") {
        scrapeArgs.push("--orders", INCREMENTAL_LISTING_ORDER);
        scrapeArgs.push("--incremental");
      } else {
        scrapeArgs.push(
          "--orders",
          listingOrdersForSegment(category.segment).join(","),
        );
      }

      console.log(
        `Scraping Auctionet (${options.mode}; skips existing bucket objects)...`,
      );
      const scrapeResult = await runScript(
        "scripts/scrape.ts",
        scrapeArgs,
        options.dryRun,
      );
      if (scrapeResult.code !== 0) {
        throw new Error(`scrape exited with code ${scrapeResult.code}`);
      }
      scrapedSaved = parseScrapeSaved(scrapeResult.output);
    }
  }

  const needsLocal =
    options.stages.has("embed") ||
    options.stages.has("store") ||
    options.stages.has("upsert");

  if (!needsLocal) {
    console.log("Skipping bucket → local sync (no embed/store/upsert stages)");
    return scrapedSaved;
  }

  const { syncCatalogPrefixDown, syncVectorsDirUp } =
    await import("../lib/catalog-bucket");

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

  console.log(
    "Preparing Vector Artifacts (skip Qdrant duplicates, reuse bucket vectors)...",
  );
  const prepared = await prepareVectors(
    category,
    options.dryRun,
    options.force,
  );
  console.log(
    `prepare vectors: qdrant-skip ${prepared.alreadyInQdrant}, downloaded ${prepared.downloaded}, pending embed ${prepared.pendingEmbed}, unsold ${prepared.unsold}`,
  );

  if (options.stages.has("embed")) {
    const embedArgs = ["--items", itemsDir, "--out", vectorsDir];
    if (options.maxItems !== null) {
      embedArgs.push("--max-items", String(options.maxItems));
    }
    if (options.dryRun) {
      embedArgs.push("--dry-run");
    }

    console.log("Embedding images (skips existing Vector Artifacts)...");
    const embedResult = await runScript(
      "scripts/embed.ts",
      embedArgs,
      false,
    );
    if (embedResult.code !== 0) {
      throw new Error(`embed exited with code ${embedResult.code}`);
    }
  }

  if (options.stages.has("store")) {
    console.log("Storing Vector Artifacts in bucket (skip existing remote)...");
    if (options.dryRun) {
      console.log(`dry-run sync up vectors: ${vectorsDir}`);
    } else {
      const up = await syncVectorsDirUp({ vectorsDir });
      console.log(
        `local → bucket vectors: uploaded ${up.uploaded}, skipped ${up.skipped}`,
      );
    }
  }

  if (options.stages.has("upsert")) {
    const upsertArgs = ["--vectors", vectorsDir, "--items", itemsDir];
    if (options.maxItems !== null) {
      upsertArgs.push("--max-items", String(options.maxItems));
    }
    if (options.dryRun) {
      upsertArgs.push("--dry-run");
    }
    if (options.force) {
      upsertArgs.push("--force");
    }

    console.log(
      options.force
        ? "Upserting Qdrant (force: rewriting existing payloads)..."
        : "Upserting Qdrant (skips artifacts whose points already exist)...",
    );
    const upsertResult = await runScript(
      "scripts/upsert.ts",
      upsertArgs,
      false,
    );
    if (upsertResult.code !== 0) {
      throw new Error(`upsert exited with code ${upsertResult.code}`);
    }
  }

  console.log(
    `bucket vectors prefix: ${categoryVectorsBucketPrefix(category.segment)}`,
  );

  return scrapedSaved;
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));

  let categories: CatalogCategory[];
  if (parsed.discoverLeaves) {
    console.log(
      `Discovering leaf categories for company_id=${parsed.companyId}...`,
    );
    categories = parsed.dryRun
      ? parseCatalogCategories(undefined)
      : await discoverCompanyLeafCategories({
          companyId: parsed.companyId,
          delayMs: 400,
        });
    console.log(
      `Discovered ${categories.length} leaves: ${categories
        .map((category) => category.segment)
        .join(", ")}`,
    );
  } else if (parsed.categoryArgs.length > 0) {
    categories = parseCatalogCategories(parsed.categoryArgs.join(","));
  } else {
    categories = parseCatalogCategories(process.env.CATALOG_CATEGORIES);
  }

  const options: CliOptions = {
    categories,
    dryRun: parsed.dryRun,
    force: parsed.force,
    stages: parsed.stages,
    maxPages: parsed.maxPages,
    maxItems: parsed.maxItems,
    mode: parsed.mode,
    discoverLeaves: parsed.discoverLeaves,
    companyId: parsed.companyId,
  };

  if (options.categories.length === 0) {
    throw new Error("No Auctionet Categories configured");
  }

  console.log(
    `Catalog pipeline (${options.mode}; stages ${[...options.stages].join(",")}) starting for ${options.categories
      .map((category) => category.segment)
      .join(", ")}`,
  );

  const needsLocal =
    options.stages.has("embed") ||
    options.stages.has("store") ||
    options.stages.has("upsert");

  // prepareVectors retrieves point IDs before upsert creates collections; ensure all leaves first.
  if (!options.dryRun && needsLocal) {
    const { ensureReferenceCollection } = await import("../lib/qdrant");
    console.log(
      `Ensuring ${AUCTIONET_LEAF_CATEGORIES.length} Qdrant collections...`,
    );
    for (const segment of AUCTIONET_LEAF_CATEGORIES) {
      await ensureReferenceCollection(segment);
    }
  }

  let scrapeBudget = options.maxItems;
  let totalSaved = 0;

  for (const category of options.categories) {
    if (options.stages.has("scrape") && scrapeBudget === 0 && !needsLocal) {
      console.log(
        `\nScrape --max-items budget exhausted after ${totalSaved} new items; stopping`,
      );
      break;
    }

    const saved = await runCategory(category, options, scrapeBudget);
    totalSaved += saved;
    if (scrapeBudget !== null) {
      scrapeBudget = Math.max(0, scrapeBudget - saved);
    }
  }

  if (options.maxItems !== null && options.stages.has("scrape")) {
    console.log(
      `\nScrape saved ${totalSaved} new items (budget ${options.maxItems})`,
    );
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
