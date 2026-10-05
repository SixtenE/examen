import "dotenv/config";

import { spawn } from "node:child_process";
import path from "node:path";
import {
  embedAuctionetItem,
  validateAuctionetItem as validateEmbeddingItem,
} from "./embed";
import {
  artifactAlreadySeeded,
  buildPoints,
  upsertArtifact,
  validateAuctionetItem,
  validateVectorArtifact,
} from "./upsert";
import { formatDuration } from "../lib/format-duration";
import {
  clearCatalogFailure,
  listFailedCatalogItems,
  recordCatalogFailure,
} from "../lib/catalog-failures";
import {
  catalogObjectExists,
  listCatalogKeyPages,
  readCatalogJson,
  putCatalogObject,
} from "../lib/catalog-bucket";
import { pathToFileURL } from "node:url";
import {
  discoverCompanyLeafCategories,
  INCREMENTAL_LISTING_ORDER,
  archiveListingOrders,
} from "../lib/auctionet-leaves";
import {
  AUCTIONET_LEAF_CATEGORIES,
  categoryBucketPrefix,
  categoryVectorsBucketPrefix,
  categoryVectorsDir,
  CRAFOORD_STOCKHOLM_COMPANY_ID,
  expectedPointIds,
  referenceCollection,
  MAX_REFERENCES_PER_ITEM,
  parseCatalogCategories,
  parsePipelineStages,
  type CatalogCategory,
  type PipelineStage,
} from "../lib/catalog-paths";

type PipelineMode = "backfill" | "incremental";

type CliOptions = {
  categories: CatalogCategory[];
  dryRun: boolean;
  force: boolean;
  retryFailed: boolean;
  stages: Set<PipelineStage>;
  maxPages: number | null;
  maxItems: number | null;
  maxEmbedItems: number | null;
  mode: PipelineMode;
  discoverLeaves: boolean;
  companyId: number;
};

function usage() {
  return [
    "Usage: pnpm cron -- [options]",
    "",
    "Daily catalog pipeline: scrape → embed → store → upsert.",
    "Bucket-backed indexing: item JSON → embed → store → upsert (no local files).",
    "",
    "Options:",
    "  --category <segment|url>   Category segment, or segment|url (repeatable)",
    "  --mode <backfill|incremental>  Scrape strategy (default: backfill)",
    "  --stages <list>            Comma list: scrape,embed,store,upsert (default: all)",
    "  --discover-leaves          Refresh leaf categories from Auctionet facets",
    `  --company-id <n>           Company for --discover-leaves (default: ${CRAFOORD_STOCKHOLM_COMPANY_ID})`,
    "  --dry-run                  Read bucket/Qdrant and print planned work without writes",
    "  --force                    Forwarded to upsert (rewrite existing Qdrant payloads)",
    "  --retry-failed             Only retry items recorded as failed in the bucket (no scrape)",
    "  --max-embed-items <n>      Max new embedding items across all categories",
    "  --max-pages <n>            Forwarded to scrape",
    "  --max-items <n>            Max newly scraped items; upsert-only artifact cap per category",
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

export function parseArgs(args: string[]): Omit<CliOptions, "categories"> & {
  categoryArgs: string[];
} {
  const categoryArgs: string[] = [];
  let dryRun = false;
  let force = false;
  let retryFailed = false;
  let stages: Set<PipelineStage> | undefined;
  let maxPages: number | null = null;
  let maxItems: number | null = null;
  let maxEmbedItems: number | null = null;
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
      case "--retry-failed":
        retryFailed = true;
        break;
      case "--max-pages":
        maxPages = parsePositiveInteger(readOptionValue(args, index, arg), arg);
        index += 1;
        break;
      case "--max-embed-items":
        maxEmbedItems = parsePositiveInteger(
          readOptionValue(args, index, arg),
          arg,
        );
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

  stages ??= parsePipelineStages(
    retryFailed ? "embed,store,upsert" : undefined,
  );
  if (retryFailed && (stages.has("scrape") || !stages.has("embed"))) {
    throw new Error(
      "--retry-failed requires the embed stage and cannot include scrape",
    );
  }
  if (stages.has("embed") && !stages.has("store")) {
    throw new Error(
      "Cron embedding requires --stages embed,store (add upsert to index Qdrant). Use pnpm embed for local files.",
    );
  }

  return {
    categoryArgs,
    dryRun,
    force,
    retryFailed,
    stages,
    maxPages,
    maxItems,
    maxEmbedItems,
    mode,
    discoverLeaves,
    companyId,
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

let indexingClient:
  | Promise<typeof import("../lib/qdrant").qdrantClient>
  | undefined;

export async function indexCategory(
  category: CatalogCategory,
  options: Pick<
    CliOptions,
    "stages" | "dryRun" | "force" | "maxItems" | "retryFailed"
  >,
  embedBudget: { remaining: number | null },
) {
  const embedding = options.stages.has("embed");
  const upserting = options.stages.has("upsert");
  const itemsPrefix = categoryBucketPrefix(category.segment);
  const vectorsPrefix = categoryVectorsBucketPrefix(category.segment);
  const prefix = embedding ? itemsPrefix : vectorsPrefix;
  const collectionName = referenceCollection(category.segment);
  const client = upserting
    ? await (indexingClient ??= import("../lib/qdrant").then(
        ({ qdrantClient }) => qdrantClient,
      ))
    : null;
  const collectionExists =
    !options.dryRun ||
    !client ||
    (await client.collectionExists(collectionName)).exists;
  const startedAt = Date.now();
  const summary = {
    checked: 0,
    embedded: 0,
    reused: 0,
    indexed: 0,
    skipped: 0,
    unsold: 0,
    failed: 0,
    images: 0,
  };
  const log = (message: string) =>
    console.log(`[${category.segment}] ${message}`);
  const failedItems = await listFailedCatalogItems(category.segment, log);
  const clearFailure = async (itemKey: string) => {
    if (!options.dryRun && failedItems.has(itemKey)) {
      await clearCatalogFailure(itemKey);
      failedItems.delete(itemKey);
      log(`Removed resolved failure: ${itemKey}`);
    }
  };
  log(
    `Reading bucket items into memory${options.dryRun ? " (dry run: reads only)" : ""}`,
  );

  // ponytail: one worker per category; use shared locks if assignments ever overlap.
  try {
    const pages = options.retryFailed
      ? [[...failedItems]]
      : listCatalogKeyPages(prefix, log);
    for await (const page of pages) {
      for (const key of page) {
        const fromItems = embedding || options.retryFailed;
        const relative = key.slice(
          (fromItems ? itemsPrefix : vectorsPrefix).length + 1,
        );
        if (!/^\d+\/\d+\.json$/.test(relative)) continue;
        if (embedding && embedBudget.remaining === 0) return summary;
        if (
          !embedding &&
          options.maxItems !== null &&
          summary.checked >= options.maxItems
        )
          return summary;
        const itemKey = fromItems ? key : `${itemsPrefix}/${relative}`;
        const vectorKey = `${vectorsPrefix}/${relative}`;
        summary.checked += 1;
        const label = `Item ${summary.checked}: ${relative}`;
        log(`${label} — reading item JSON`);
        let vectorsSaved = false;
        try {
          const raw = await readCatalogJson(itemKey);
          const item = validateEmbeddingItem(raw, itemKey);
          if (String(item.auctionet_id) !== path.basename(relative, ".json")) {
            throw new Error(`Item ID does not match bucket key: ${itemKey}`);
          }
          if (item.status !== "sold") {
            summary.unsold += 1;
            log(`${label} — skipped (${item.status ?? "missing status"})`);
            continue;
          }
          if (
            !Number.isSafeInteger(
              item.auctionet_id * MAX_REFERENCES_PER_ITEM +
                MAX_REFERENCES_PER_ITEM -
                1,
            ) ||
            item.auctionet_id < 1 ||
            item.image_urls.length === 0 ||
            item.image_urls.length > MAX_REFERENCES_PER_ITEM
          ) {
            throw new Error(`Invalid item ID or image count in ${itemKey}`);
          }
          const metadata = validateAuctionetItem(raw, itemKey);
          if (client)
            log(
              `${label} — checking Qdrant duplicate IDs (${item.image_urls.length} images)`,
            );
          const indexed =
            client && collectionExists
              ? await artifactAlreadySeeded(
                  client,
                  collectionName,
                  expectedPointIds(item.auctionet_id, item.image_urls.length),
                )
              : false;
          if (indexed && !options.force) {
            summary.skipped += 1;
            log(`${label} — skipped (fully indexed)`);
            await clearFailure(itemKey);
            continue;
          }

          log(`${label} — checking saved vector artifact`);
          const saved = !embedding || (await catalogObjectExists(vectorKey));
          if (!saved && indexed) {
            summary.skipped += 1;
            log(
              `${label} — skipped (fully indexed; no saved artifact for --force)`,
            );
            await clearFailure(itemKey);
            continue;
          }
          if (!saved && options.dryRun) {
            if (embedBudget.remaining !== null) embedBudget.remaining -= 1;
            summary.embedded += 1;
            summary.images += item.image_urls.length;
            if (upserting) summary.indexed += 1;
            log(
              `${label} — would embed ${item.image_urls.length} images → upload ${vectorKey}${upserting ? " → upsert Qdrant" : ""}`,
            );
            if (embedBudget.remaining === 0) return summary;
            continue;
          }

          let artifact;
          if (saved) {
            log(`${label} — reading saved vectors into memory`);
            artifact = validateVectorArtifact(
              await readCatalogJson(vectorKey),
              vectorKey,
            );
            summary.reused += 1;
          } else {
            if (embedBudget.remaining !== null) embedBudget.remaining -= 1;
            log(`${label} — embedding ${item.image_urls.length} images`);
            artifact = validateVectorArtifact(
              await embedAuctionetItem(item, {
                onProgress: (message) => log(`${label} — ${message}`),
              }),
              vectorKey,
            );
            buildPoints(artifact, metadata);
            summary.embedded += 1;
            summary.images += artifact.references.length;
            log(`${label} — uploading vector artifact: ${vectorKey}`);
            const stored = await putCatalogObject(
              vectorKey,
              `${JSON.stringify(artifact)}\n`,
            );
            if (stored.skipped)
              artifact = validateVectorArtifact(
                await readCatalogJson(vectorKey),
                vectorKey,
              );
            log(`${label} — vector artifact saved in bucket`);
          }

          // Validate the item/artifact pair even in embed/store-only runs.
          buildPoints(artifact, metadata);
          vectorsSaved = true;
          await clearFailure(itemKey);
          if (upserting) {
            log(
              `${label} — ${options.dryRun ? "would upsert" : "upserting"} ${artifact.references.length} Qdrant points`,
            );
            const result = await upsertArtifact(
              artifact,
              metadata,
              {
                collectionName,
                batchSize: 100,
                force: options.force,
                dryRun: options.dryRun,
              },
              client,
              vectorKey,
            );
            if (result.skipped) summary.skipped += 1;
            else summary.indexed += 1;
            log(`${label} — ${options.dryRun ? "planned" : "completed"}`);
          }
        } catch (error) {
          summary.failed += 1;
          console.error(
            `[${category.segment}] ${label} — failed: ${error instanceof Error ? error.message : String(error)}`,
          );
          if (embedding && !vectorsSaved && !options.dryRun) {
            await recordCatalogFailure(itemKey, error);
          }
          // Stop on service failures rather than spending on more embeddings during an outage.
          throw error;
        } finally {
          log(
            `Progress: ${summary.checked} checked, ${summary.embedded} ${options.dryRun ? "would embed" : "embedded"}, ${summary.reused} reused, ${summary.indexed} ${options.dryRun ? "would index" : "indexed"}, ${summary.skipped} skipped, ${summary.unsold} unsold, ${summary.failed} failed; elapsed ${formatDuration(Date.now() - startedAt)}; embedding budget ${embedBudget.remaining ?? "unlimited"}`,
          );
        }
        if (embedding && embedBudget.remaining === 0) return summary;
      }
    }
    return summary;
  } finally {
    log(
      `Summary: ${summary.checked} checked, ${summary.embedded} ${options.dryRun ? "would embed" : "embedded"} (${summary.images} images), ${summary.reused} reused, ${summary.indexed} ${options.dryRun ? "would index" : "indexed"}, ${summary.skipped} skipped, ${summary.unsold} unsold, ${summary.failed} failed in ${formatDuration(Date.now() - startedAt)}`,
    );
  }
}

async function runCategory(
  category: CatalogCategory,
  options: CliOptions,
  scrapeMaxItems: number | null,
  embedBudget: { remaining: number | null },
) {
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
        scrapeArgs.push("--orders", archiveListingOrders().join(","));
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

  if (options.stages.has("embed") || options.stages.has("upsert")) {
    await indexCategory(category, options, embedBudget);
  } else if (options.stages.has("store")) {
    // Explicit recovery command for artifacts made by the standalone local embed CLI.
    const { syncVectorsDirUp } = await import("../lib/catalog-bucket");
    const vectorsDir = categoryVectorsDir(category.segment);
    if (options.dryRun)
      console.log(`dry-run: upload existing local vectors from ${vectorsDir}`);
    else {
      const up = await syncVectorsDirUp({
        vectorsDir,
        onProgress: (done, total) =>
          console.log(`Store progress: ${done}/${total} local artifacts`),
      });
      console.log(
        `local → bucket vectors: uploaded ${up.uploaded}, skipped ${up.skipped}`,
      );
    }
  }

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
    retryFailed: parsed.retryFailed,
    stages: parsed.stages,
    maxPages: parsed.maxPages,
    maxItems: parsed.maxItems,
    maxEmbedItems: parsed.maxEmbedItems,
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

  const needsIndexing =
    options.stages.has("embed") ||
    options.stages.has("store") ||
    options.stages.has("upsert");

  // Search requires every leaf collection, including empty categories.
  if (!options.dryRun && options.stages.has("upsert")) {
    const { ensureReferenceCollection } = await import("../lib/qdrant");
    console.log(
      `Ensuring ${AUCTIONET_LEAF_CATEGORIES.length} Qdrant collections...`,
    );
    for (const segment of AUCTIONET_LEAF_CATEGORIES) {
      await ensureReferenceCollection(segment);
    }
  }

  let scrapeBudget = options.maxItems;
  const embedBudget = { remaining: options.maxEmbedItems };
  let totalSaved = 0;

  for (const category of options.categories) {
    if (options.stages.has("scrape") && scrapeBudget === 0 && !needsIndexing) {
      console.log(
        `\nScrape --max-items budget exhausted after ${totalSaved} new items; stopping`,
      );
      break;
    }

    if (
      options.stages.has("embed") &&
      !options.stages.has("scrape") &&
      embedBudget.remaining === 0
    ) {
      console.log(
        `\nEmbed --max-embed-items budget of ${options.maxEmbedItems} reached; stopping`,
      );
      break;
    }

    const saved = await runCategory(
      category,
      options,
      scrapeBudget,
      embedBudget,
    );
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

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
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
