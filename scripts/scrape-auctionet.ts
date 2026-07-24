import {
  extractAuctionetImages,
  extractAuctionetItemUrls,
  extractNextListingPageUrl,
  fetchAuctionetHtml,
  getTagAttributes,
  normalizeAuctionetUrl,
  stripHtmlTags,
} from "../lib/auctionet";
import {
  extractEndedItemCount,
  listingOrdersForSegment,
  withListingOrder,
} from "../lib/auctionet-leaves";
import { catalogObjectExists, putCatalogObject } from "../lib/catalog-bucket";
import {
  categorySegmentFromSearchUrl,
  itemBucketKey,
} from "../lib/catalog-paths";
import { setTimeout as sleep } from "node:timers/promises";

type CliOptions = {
  url: URL;
  segment: string;
  force: boolean;
  delayMs: number;
  concurrency: number;
  maxPages: number | null;
  maxItems: number | null;
  orders: string[];
  incremental: boolean;
};

type CrawlFailure = {
  url: string;
  auctionet_id?: number;
  reason: string;
};

type CrawlStats = {
  discovered_item_count: number;
  saved_item_count: number;
  skipped_item_count: number;
  failed_item_count: number;
  failures: CrawlFailure[];
};

type AuctionetItemJson = {
  auctionet_id: number;
  source_url: string;
  scraped_at: string;
  title: string | null;
  description: string | null;
  condition: string | null;
  breadcrumbs: string[];
  auction_house: string | null;
  seller: string | null;
  currency: string | null;
  estimate: string | null;
  upper_estimate: string | null;
  price: string | null;
  highest_bid: string | null;
  bid_count: number;
  status: string | null;
  dates: Record<string, string>;
  attributes: Record<string, string | string[]>;
  image_urls: string[];
  metadata: {
    meta_tags: Record<string, string | string[]>;
    structured_data: unknown[];
    vip_data_item: Record<string, unknown> | null;
  };
};

const DEFAULT_DELAY_MS = 750;
const DEFAULT_CONCURRENCY = 2;

function usage() {
  return [
    "Usage: pnpm scrape:auctionet -- --url <auctionet-category-url> [options]",
    "",
    "Writes Auctionet Item JSON to the Railway bucket under scrape/{segment}/…",
    "Category segment is taken from the URL path (/…/search/{segment}).",
    "",
    "Options:",
    "  --force               Re-fetch and overwrite existing bucket objects",
    `  --delay-ms <ms>       Delay after each item fetch (default: ${DEFAULT_DELAY_MS})`,
    `  --concurrency <n>     Item page fetch concurrency (default: ${DEFAULT_CONCURRENCY})`,
    "  --max-pages <n>       Stop listing pagination after n pages (per order)",
    "  --max-items <n>       Stop after saving n new items (skips do not count)",
    "  --orders <a,b,…>     Listing sort orders to union (default: segment-aware)",
    "  --incremental         Stop an order after a full page of already-bucketed items",
  ].join("\n");
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

function readOptionValue(args: string[], index: number, name: string) {
  const value = args[index + 1];

  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }

  return value;
}

function parseOrders(value: string) {
  const orders = value
    .split(",")
    .map((order) => order.trim())
    .filter(Boolean);

  if (orders.length === 0) {
    throw new Error("--orders requires at least one order");
  }

  return orders;
}

function parseArgs(args: string[]): CliOptions {
  let url: URL | null = null;
  let force = false;
  let delayMs = DEFAULT_DELAY_MS;
  let concurrency = DEFAULT_CONCURRENCY;
  let maxPages: number | null = null;
  let maxItems: number | null = null;
  let orders: string[] | null = null;
  let incremental = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    switch (arg) {
      case "--":
        break;
      case "--url":
        url = normalizeAuctionetUrl(readOptionValue(args, index, arg), "url");
        index += 1;
        break;
      case "--force":
        force = true;
        break;
      case "--delay-ms":
        delayMs = parseNonNegativeInteger(
          readOptionValue(args, index, arg),
          arg,
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
      case "--max-pages":
        maxPages = parsePositiveInteger(readOptionValue(args, index, arg), arg);
        index += 1;
        break;
      case "--max-items":
        maxItems = parsePositiveInteger(readOptionValue(args, index, arg), arg);
        index += 1;
        break;
      case "--orders":
        orders = parseOrders(readOptionValue(args, index, arg));
        index += 1;
        break;
      case "--incremental":
        incremental = true;
        break;
      case "--help":
      case "-h":
        console.log(usage());
        process.exit(0);
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!url) {
    throw new Error("Missing required option: --url");
  }

  const segment = categorySegmentFromSearchUrl(url);

  return {
    url,
    segment,
    force,
    delayMs,
    concurrency,
    maxPages,
    maxItems,
    orders: orders ?? listingOrdersForSegment(segment),
    incremental,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function mergeRecordValue(
  record: Record<string, string | string[]>,
  key: string,
  value: string,
) {
  const normalizedKey = key.trim().replaceAll(/\s+/g, " ");
  const normalizedValue = value.trim().replaceAll(/\s+/g, " ");

  if (!normalizedKey || !normalizedValue) {
    return;
  }

  const existing = record[normalizedKey];

  if (!existing) {
    record[normalizedKey] = normalizedValue;
    return;
  }

  record[normalizedKey] = Array.isArray(existing)
    ? Array.from(new Set([...existing, normalizedValue]))
    : Array.from(new Set([existing, normalizedValue]));
}

function extractMetaTags(html: string) {
  const metaTags: Record<string, string | string[]> = {};
  const pattern = /<meta\b([^>]*)>/gi;

  for (const match of html.matchAll(pattern)) {
    const attributes = getTagAttributes(match[1]);
    const key = attributes.property ?? attributes.name ?? attributes.itemprop;
    const content = attributes.content;

    if (key && content) {
      mergeRecordValue(metaTags, key, content);
    }
  }

  return metaTags;
}

function getMetaValue(
  metaTags: Record<string, string | string[]>,
  keys: string[],
) {
  for (const key of keys) {
    const value = metaTags[key];

    if (typeof value === "string") {
      return value;
    }

    if (Array.isArray(value) && value[0]) {
      return value[0];
    }
  }

  return null;
}

function extractJsonLd(html: string) {
  const entries: unknown[] = [];
  const pattern =
    /<script\b[^>]*type\s*=\s*(["'])application\/ld\+json\1[^>]*>([\s\S]*?)<\/script>/gi;

  for (const match of html.matchAll(pattern)) {
    const content = match[2].trim();

    if (!content) {
      continue;
    }

    try {
      entries.push(JSON.parse(content));
    } catch {
      // Keep scraping even when a page includes malformed structured data.
    }
  }

  return entries;
}

function extractWindowAssignmentObject(html: string, name: string) {
  const marker = `${name} = `;
  const start = html.indexOf(marker);

  if (start === -1) {
    return null;
  }

  const jsonStart = start + marker.length;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = jsonStart; index < html.length; index += 1) {
    const char = html[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;

      if (depth === 0) {
        try {
          return JSON.parse(html.slice(jsonStart, index + 1));
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}

function extractVipDataItem(html: string) {
  const payload = extractWindowAssignmentObject(
    html,
    "window.vipDataAtPageLoad",
  );

  return isRecord(payload) && isRecord(payload.item) ? payload.item : null;
}

function flattenStructuredData(entries: unknown[]) {
  const flattened: Record<string, unknown>[] = [];
  const visit = (entry: unknown) => {
    if (Array.isArray(entry)) {
      entry.forEach(visit);
      return;
    }

    if (!isRecord(entry)) {
      return;
    }

    flattened.push(entry);

    const graph = entry["@graph"];
    if (Array.isArray(graph)) {
      graph.forEach(visit);
    }
  };

  entries.forEach(visit);
  return flattened;
}

function typeMatches(entry: Record<string, unknown>, expected: string) {
  const type = entry["@type"];

  if (typeof type === "string") {
    return type.toLowerCase() === expected.toLowerCase();
  }

  if (Array.isArray(type)) {
    return type.some(
      (value) =>
        typeof value === "string" &&
        value.toLowerCase() === expected.toLowerCase(),
    );
  }

  return false;
}

function findStructuredEntry(entries: Record<string, unknown>[], type: string) {
  return entries.find((entry) => typeMatches(entry, type)) ?? null;
}

function extractBreadcrumbs(entries: Record<string, unknown>[], html: string) {
  const breadcrumbList = findStructuredEntry(entries, "BreadcrumbList");
  const itemListElement = isRecord(breadcrumbList)
    ? breadcrumbList.itemListElement
    : null;

  if (Array.isArray(itemListElement)) {
    return itemListElement
      .map((item) => {
        if (!isRecord(item)) {
          return null;
        }

        return textValue(item.name);
      })
      .filter((value): value is string => value !== null);
  }

  const navMatch = html.match(
    /<nav\b[^>]*(?:aria-label\s*=\s*(["'])breadcrumb\1|class\s*=\s*(["'])[^"']*breadcrumb[^"']*\2)[^>]*>([\s\S]*?)<\/nav>/i,
  );

  if (!navMatch) {
    return [];
  }

  return Array.from(navMatch[0].matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi))
    .map((match) => stripHtmlTags(match[1]))
    .filter(Boolean);
}

function extractFirstTagText(html: string, tagName: string) {
  const pattern = new RegExp(
    `<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`,
    "i",
  );
  const match = html.match(pattern);

  return match ? stripHtmlTags(match[1]) : null;
}

function extractSectionText(html: string, heading: string) {
  const headingPattern = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  const headings = Array.from(html.matchAll(headingPattern));
  const targetIndex = headings.findIndex((match) => {
    const text = stripHtmlTags(match[2]).toLowerCase();
    return text === heading.toLowerCase();
  });

  if (targetIndex === -1) {
    return null;
  }

  const current = headings[targetIndex];
  const next = headings[targetIndex + 1];
  const start = (current.index ?? 0) + current[0].length;
  const end = next?.index ?? html.length;
  const text = stripHtmlTags(html.slice(start, end));

  return text.length > 0 ? text : null;
}

function extractDefinitionAttributes(html: string) {
  const attributes: Record<string, string | string[]> = {};
  const definitionPattern =
    /<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi;
  const tableRowPattern =
    /<tr\b[^>]*>\s*<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>\s*<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>\s*<\/tr>/gi;

  for (const match of html.matchAll(definitionPattern)) {
    mergeRecordValue(
      attributes,
      stripHtmlTags(match[1]),
      stripHtmlTags(match[2]),
    );
  }

  for (const match of html.matchAll(tableRowPattern)) {
    mergeRecordValue(
      attributes,
      stripHtmlTags(match[1]),
      stripHtmlTags(match[2]),
    );
  }

  return attributes;
}

function findAttributeValue(
  attributes: Record<string, string | string[]>,
  pattern: RegExp,
) {
  for (const [key, value] of Object.entries(attributes)) {
    if (!pattern.test(key)) {
      continue;
    }

    return Array.isArray(value) ? value[0] : value;
  }

  return null;
}

function extractDates(attributes: Record<string, string | string[]>) {
  const dates: Record<string, string> = {};

  for (const [key, value] of Object.entries(attributes)) {
    if (!/(date|time|start|end|closing|created|updated|datum|tid)/i.test(key)) {
      continue;
    }

    dates[key] = Array.isArray(value) ? value.join("; ") : value;
  }

  return dates;
}

function extractOffer(product: Record<string, unknown> | null) {
  const offers = product?.offers;

  if (Array.isArray(offers)) {
    return offers.find(isRecord) ?? null;
  }

  return isRecord(offers) ? offers : null;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatMoney(value: unknown, currency: string | null) {
  const amount = numberValue(value);

  if (amount === null) {
    return null;
  }

  return currency ? `${amount} ${currency}` : String(amount);
}

function extractBidAmount(bid: unknown) {
  return isRecord(bid) ? numberValue(bid.amount) : null;
}

function extractHighestBid(vipItem: Record<string, unknown> | null) {
  const bids = Array.isArray(vipItem?.bids) ? vipItem.bids : [];

  return bids.reduce<number | null>((highest, bid) => {
    const amount = extractBidAmount(bid);

    if (amount === null) {
      return highest;
    }

    return highest === null || amount > highest ? amount : highest;
  }, null);
}

function extractAuctionHouse(attributes: Record<string, string | string[]>) {
  return findAttributeValue(
    attributes,
    /(auction house|seller|house|auktionshus)/i,
  );
}

function extractAuctionetItemJson(
  html: string,
  sourceUrl: URL,
  auctionetId: number,
): AuctionetItemJson {
  const metaTags = extractMetaTags(html);
  const structuredData = extractJsonLd(html);
  const structuredEntries = flattenStructuredData(structuredData);
  const product = findStructuredEntry(structuredEntries, "Product");
  const offer = extractOffer(product);
  const vipItem = extractVipDataItem(html);
  const attributes = extractDefinitionAttributes(html);
  const currency =
    textValue(vipItem?.currency) ??
    textValue(vipItem?.original_currency) ??
    textValue(offer?.priceCurrency);
  const title =
    textValue(product?.name) ??
    getMetaValue(metaTags, ["og:title", "twitter:title"]) ??
    extractFirstTagText(html, "h1") ??
    extractFirstTagText(html, "title");
  const description =
    textValue(product?.description) ??
    extractSectionText(html, "Description") ??
    getMetaValue(metaTags, ["description", "og:description"]);
  const condition =
    extractSectionText(html, "Condition") ??
    findAttributeValue(attributes, /(condition|skick)/i);
  const offerPrice = offer
    ? [textValue(offer.price), textValue(offer.priceCurrency)]
        .filter(Boolean)
        .join(" ")
    : "";
  const highestBid = extractHighestBid(vipItem);
  const formattedHighestBid = formatMoney(highestBid, currency);
  const price =
    offerPrice.length > 0
      ? offerPrice
      : (formattedHighestBid ??
        findAttributeValue(attributes, /(price|hammer|sold|pris)/i));
  const dates = extractDates(attributes);
  const endsAt = textValue(vipItem?.ends_at_string);

  if (endsAt) {
    dates.ends_at = endsAt;
  }

  return {
    auctionet_id: auctionetId,
    source_url: sourceUrl.toString(),
    scraped_at: new Date().toISOString(),
    title,
    description,
    condition,
    breadcrumbs: extractBreadcrumbs(structuredEntries, html),
    auction_house: extractAuctionHouse(attributes),
    seller: findAttributeValue(attributes, /(seller|säljare)/i),
    currency,
    estimate:
      formatMoney(vipItem?.estimate, currency) ??
      findAttributeValue(attributes, /(estimate|värdering|utrop)/i),
    upper_estimate: formatMoney(vipItem?.upper_estimate, currency),
    price,
    highest_bid: formattedHighestBid,
    bid_count: Array.isArray(vipItem?.bids) ? vipItem.bids.length : 0,
    status:
      textValue(vipItem?.state) ??
      textValue(offer?.availability) ??
      findAttributeValue(attributes, /(status|ended|closed|avslutad)/i),
    dates,
    attributes,
    image_urls: extractAuctionetImages(html, auctionetId).map(
      (image) => image.image_url,
    ),
    metadata: {
      meta_tags: metaTags,
      structured_data: structuredData,
      vip_data_item: vipItem,
    },
  };
}

function getAuctionetIdFromUrl(url: URL) {
  const match = url.pathname.match(/^\/(?:[a-z]{2}\/)?(\d+)(?:[-/]|$)/i);

  if (!match) {
    throw new Error(`Could not find Auctionet id in ${url.toString()}`);
  }

  return Number(match[1]);
}

function isAllowedListingPage(nextUrl: URL, startUrl: URL) {
  return (
    nextUrl.origin === startUrl.origin && nextUrl.pathname === startUrl.pathname
  );
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

function createPageProgress(pageNumber: number, totalItems: number) {
  const pageStartedAt = performance.now();
  const recentDurations: number[] = [];
  let done = 0;

  return {
    record(durationMs: number) {
      done += 1;
      recentDurations.push(durationMs);
      if (recentDurations.length > 50) {
        recentDurations.shift();
      }
    },
    report() {
      const elapsedMs = performance.now() - pageStartedAt;
      const percent =
        totalItems > 0 ? Math.round((done / totalItems) * 100) : 100;
      const averageMs =
        recentDurations.length > 0
          ? recentDurations.reduce((sum, value) => sum + value, 0) /
            recentDurations.length
          : 0;
      const etaMs = averageMs * (totalItems - done);

      return `Page ${pageNumber}: ${done}/${totalItems} (${percent}%), elapsed ${formatDuration(elapsedMs)}, ETA ${formatDuration(etaMs)}`;
    },
  };
}

async function scrapeItem(
  auctionetId: number,
  itemUrl: URL,
  options: CliOptions,
  stats: CrawlStats,
): Promise<"saved" | "skipped" | "failed"> {
  if (options.maxItems && stats.saved_item_count >= options.maxItems) {
    return "skipped";
  }

  const key = itemBucketKey(options.segment, auctionetId);

  if (!options.force && (await catalogObjectExists(key))) {
    stats.skipped_item_count += 1;
    return "skipped";
  }

  try {
    const html = await fetchAuctionetHtml(itemUrl);
    const item = extractAuctionetItemJson(html, itemUrl, auctionetId);
    await putCatalogObject(key, `${JSON.stringify(item, null, 2)}\n`, {
      skipExisting: false,
    });
    stats.saved_item_count += 1;
    return "saved";
  } catch (error) {
    stats.failures.push({
      url: itemUrl.toString(),
      auctionet_id: auctionetId,
      reason: error instanceof Error ? error.message : String(error),
    });
    return "failed";
  } finally {
    if (options.delayMs > 0) {
      await sleep(options.delayMs);
    }
  }
}

async function scrapePageItems(
  entries: [number, URL][],
  pageNumber: number,
  options: CliOptions,
  stats: CrawlStats,
) {
  if (entries.length === 0) {
    console.log(`Page ${pageNumber}: 0/0 (100%), elapsed 0s, ETA 0s`);
    return { saved: 0, skipped: 0, failed: 0 };
  }

  const progress = createPageProgress(pageNumber, entries.length);
  let nextIndex = 0;
  const results: Array<"saved" | "skipped" | "failed"> = [];

  async function worker() {
    while (nextIndex < entries.length) {
      const entry = entries[nextIndex];
      nextIndex += 1;
      const startedAt = performance.now();
      const result = await scrapeItem(entry[0], entry[1], options, stats);
      results.push(result);
      progress.record(performance.now() - startedAt);
      console.log(progress.report());
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(options.concurrency, entries.length) },
      () => worker(),
    ),
  );

  return {
    saved: results.filter((result) => result === "saved").length,
    skipped: results.filter((result) => result === "skipped").length,
    failed: results.filter((result) => result === "failed").length,
  };
}

async function crawlListingOrder(
  startUrl: URL,
  order: string,
  options: CliOptions,
  stats: CrawlStats,
  seenAuctionetIds: Set<number>,
) {
  const visitedListingUrls = new Set<string>();
  let listingUrl: URL | null = withListingOrder(startUrl, order);
  let pageNumber = 0;
  let pagesVisited = 0;

  console.log(`Order ${order}: starting at ${listingUrl.toString()}`);

  while (listingUrl) {
    const listingUrlKey = listingUrl.toString();

    if (visitedListingUrls.has(listingUrlKey)) {
      break;
    }

    if (options.maxPages && pagesVisited >= options.maxPages) {
      break;
    }

    visitedListingUrls.add(listingUrlKey);
    pagesVisited += 1;
    pageNumber += 1;
    console.log(
      `Fetching listing page ${pageNumber} (${order}): ${listingUrlKey}`,
    );

    const html = await fetchAuctionetHtml(listingUrl);

    if (pageNumber === 1) {
      const facetCount = extractEndedItemCount(html);
      if (facetCount !== null) {
        console.log(`Facet ended count for ${options.segment}: ${facetCount}`);
      }
    }

    const discovered = extractAuctionetItemUrls(html, listingUrl);
    const pageEntries: [number, URL][] = [];
    let newOnPage = 0;

    for (const itemUrl of discovered) {
      const auctionetId = getAuctionetIdFromUrl(itemUrl);

      if (seenAuctionetIds.has(auctionetId)) {
        continue;
      }

      seenAuctionetIds.add(auctionetId);
      newOnPage += 1;
      pageEntries.push([auctionetId, itemUrl]);
      stats.discovered_item_count = seenAuctionetIds.size;
    }

    // Later orders: stop once we reach the overlap with prior orders.
    if (discovered.length > 0 && newOnPage === 0) {
      console.log(
        `Order ${order}: page ${pageNumber} had no new IDs — overlap reached`,
      );
      break;
    }

    const nextUrl = extractNextListingPageUrl(html, listingUrl);
    const allowedNextUrl =
      nextUrl && isAllowedListingPage(nextUrl, startUrl) ? nextUrl : null;

    const pageStats = await scrapePageItems(
      pageEntries,
      pageNumber,
      options,
      stats,
    );

    if (
      options.incremental &&
      pageEntries.length > 0 &&
      pageStats.saved === 0 &&
      pageStats.failed === 0 &&
      pageStats.skipped === pageEntries.length
    ) {
      console.log(
        `Order ${order}: page ${pageNumber} all already in bucket — incremental stop`,
      );
      break;
    }

    if (options.maxItems && stats.saved_item_count >= options.maxItems) {
      console.log(
        `Reached --max-items ${options.maxItems} newly saved items`,
      );
      break;
    }

    listingUrl = allowedNextUrl;
  }
}

async function crawlAuctionet(options: CliOptions, stats: CrawlStats) {
  const seenAuctionetIds = new Set<number>();

  for (const order of options.orders) {
    if (options.maxItems && stats.saved_item_count >= options.maxItems) {
      break;
    }

    await crawlListingOrder(
      options.url,
      order,
      options,
      stats,
      seenAuctionetIds,
    );
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  console.log(
    `Scraping ${options.segment} → bucket prefix scrape/${options.segment}/`,
  );
  console.log(
    `Orders: ${options.orders.join(", ")}${options.incremental ? " (incremental)" : ""}`,
  );

  const stats: CrawlStats = {
    discovered_item_count: 0,
    saved_item_count: 0,
    skipped_item_count: 0,
    failed_item_count: 0,
    failures: [],
  };

  await crawlAuctionet(options, stats);
  stats.failed_item_count = stats.failures.length;

  console.log(`Discovered ${stats.discovered_item_count} Auctionet Items`);
  console.log(
    `Saved ${stats.saved_item_count}, skipped ${stats.skipped_item_count}, failed ${stats.failed_item_count}`,
  );
  // Parsed by catalog:pipeline to share --max-items across categories.
  console.log(`SCRAPE_SAVED=${stats.saved_item_count}`);

  if (stats.failed_item_count > 0) {
    for (const failure of stats.failures) {
      console.error(
        `failed ${failure.auctionet_id ?? "?"}: ${failure.reason} (${failure.url})`,
      );
    }
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  console.error(usage());
  process.exitCode = 1;
});
