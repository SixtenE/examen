import path from "node:path";

export const CATALOG_BUCKET_PREFIX = "scrape";
export const LOCAL_CATALOG_ROOT = "data/auctionet/items";
export const CATEGORY_SEGMENT_PATTERN = /^\d+-[a-z0-9-]+$/;
export const MAX_REFERENCES_PER_ITEM = 100;
export const CRAFOORD_STOCKHOLM_COMPANY_ID = 232;

export const PIPELINE_STAGES = ["scrape", "embed", "store", "upsert"] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export type CatalogCategory = {
  segment: string;
  url: string;
};

export function parsePipelineStages(value: string | undefined): Set<PipelineStage> {
  if (!value?.trim()) {
    return new Set(PIPELINE_STAGES);
  }

  const stages = new Set<PipelineStage>();

  for (const entry of value.split(",")) {
    const stage = entry.trim();

    if (stage.length === 0) {
      throw new Error("PIPELINE_STAGES contains an empty entry");
    }

    if (!(PIPELINE_STAGES as readonly string[]).includes(stage)) {
      throw new Error(
        `Unknown pipeline stage: ${stage} (expected ${PIPELINE_STAGES.join(", ")})`,
      );
    }

    stages.add(stage as PipelineStage);
  }

  return stages;
}

/** Auctionet leaf taxonomy — parents Art/Furniture expanded; scrape URLs stay company-filtered. */
export const AUCTIONET_LEAF_CATEGORIES = [
  "1-lighting-lamps",
  "6-glass",
  "9-ceramics-porcelain",
  "13-jewellery-gemstones",
  "17-other",
  "18-armchairs-chairs",
  "19-tables",
  "20-sofas-seatings",
  "22-dining-room-furniture",
  "23-cupboards-cabinets-shelves",
  "24-chests-of-drawers",
  "26-photography",
  "27-engravings-prints",
  "28-paintings",
  "29-sculptures-bronzes",
  "30-other",
  "31-clocks-watches",
  "35-carpets-textiles",
  "38-silver-metals",
  "42-mirrors",
  "43-miscellaneous",
  "44-toys",
  "46-coins-medals-stamps",
  "49-vintage-designer-fashion",
  "50-books-maps-manuscripts",
  "57-photo-cameras-lenses",
  "58-swedish-folk-art",
  "59-licence-weapons",
  "117-asiatica",
  "119-drawings",
  "134-ethnographica",
  "137-weapons-militaria",
  "170-wine-port-spirits",
  "249-vehicles-boats-parts",
  "261-collectables",
  "270-garden-architectural",
  "279-desks",
  "280-coffee-tables",
  "281-dining-tables",
] as const;

export function companyCategoryUrl(
  segment: string,
  companyId = CRAFOORD_STOCKHOLM_COMPANY_ID,
) {
  return `https://auctionet.com/en/search/${assertCategorySegment(segment)}?is=ended&company_id=${companyId}`;
}

/** Leaf categories with Auction House–scoped listing URLs. */
export const DEFAULT_CATALOG_CATEGORIES: CatalogCategory[] =
  AUCTIONET_LEAF_CATEGORIES.map((segment) => ({
    segment,
    url: companyCategoryUrl(segment),
  }));

export function assertCategorySegment(segment: string) {
  if (!CATEGORY_SEGMENT_PATTERN.test(segment)) {
    throw new Error(
      `Invalid Auctionet Category segment: ${segment} (expected like 9-ceramics-porcelain)`,
    );
  }

  return segment;
}

/** Qdrant collection name for one Auctionet Category. */
export function referenceCollection(segment: string) {
  return `references-${assertCategorySegment(segment)}`;
}

export const REFERENCE_COLLECTIONS = AUCTIONET_LEAF_CATEGORIES.map(referenceCollection);

export function categoryItemsDir(segment: string, root = LOCAL_CATALOG_ROOT) {
  return path.join(root, assertCategorySegment(segment));
}

export function categoryVectorsDir(segment: string, root = LOCAL_CATALOG_ROOT) {
  return path.join(categoryItemsDir(segment, root), "vectors");
}

export function categoryBucketPrefix(segment: string) {
  return `${CATALOG_BUCKET_PREFIX}/${assertCategorySegment(segment)}`;
}

export function categoryVectorsBucketPrefix(segment: string) {
  return `${categoryBucketPrefix(segment)}/vectors`;
}

/** Auctionet Category segment from a listing URL path (`/…/search/{segment}`). */
export function categorySegmentFromSearchUrl(url: URL | string) {
  const parsed = typeof url === "string" ? new URL(url) : url;
  const parts = parsed.pathname.split("/").filter(Boolean);
  const searchIndex = parts.indexOf("search");

  if (searchIndex === -1 || searchIndex === parts.length - 1) {
    throw new Error(
      `Auctionet search URL is missing a category segment: ${parsed.toString()}`,
    );
  }

  return assertCategorySegment(parts[searchIndex + 1]);
}

/** Durable bucket key for one scraped Auctionet Item JSON. */
export function itemBucketKey(segment: string, auctionetId: number) {
  const filename = `${auctionetId}.json`;
  const folder = filename.slice(0, 3);
  return `${categoryBucketPrefix(segment)}/${folder}/${filename}`;
}

/** Maps a local catalog file to its durable bucket key. */
export function localPathToBucketKey(
  localPath: string,
  localRoot = LOCAL_CATALOG_ROOT,
) {
  const absoluteLocal = path.resolve(localPath);
  const absoluteRoot = path.resolve(localRoot);
  const relative = path.relative(absoluteRoot, absoluteLocal);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${localPath} is outside catalog root ${localRoot}`);
  }

  return `${CATALOG_BUCKET_PREFIX}/${relative.split(path.sep).join("/")}`;
}

export function bucketKeyToLocalPath(
  key: string,
  localRoot = LOCAL_CATALOG_ROOT,
) {
  const prefix = `${CATALOG_BUCKET_PREFIX}/`;

  if (!key.startsWith(prefix)) {
    throw new Error(
      `${key} is outside catalog bucket prefix ${CATALOG_BUCKET_PREFIX}`,
    );
  }

  const localPath = path.join(
    localRoot,
    ...key.slice(prefix.length).split("/"),
  );
  const relative = path.relative(
    path.resolve(localRoot),
    path.resolve(localPath),
  );
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${key} is outside catalog root ${localRoot}`);
  }

  return localPath;
}

export function getPointId(auctionetId: number, imageIndex: number) {
  return auctionetId * MAX_REFERENCES_PER_ITEM + imageIndex;
}

export function expectedPointIds(auctionetId: number, referenceCount: number) {
  return Array.from({ length: referenceCount }, (_, imageIndex) =>
    getPointId(auctionetId, imageIndex),
  );
}

export function parseCatalogCategories(
  value: string | undefined,
  defaults: CatalogCategory[] = DEFAULT_CATALOG_CATEGORIES,
): CatalogCategory[] {
  if (!value || value.trim().length === 0) {
    return defaults;
  }

  return value.split(",").map((entry) => {
    const trimmed = entry.trim();

    if (trimmed.length === 0) {
      throw new Error("CATALOG_CATEGORIES contains an empty entry");
    }

    const separator = trimmed.indexOf("|");
    if (separator === -1) {
      const segment = assertCategorySegment(trimmed);
      return {
        segment,
        url: companyCategoryUrl(segment),
      };
    }

    const segment = assertCategorySegment(trimmed.slice(0, separator).trim());
    const url = trimmed.slice(separator + 1).trim();

    if (!url) {
      throw new Error(
        `CATALOG_CATEGORIES entry for ${segment} is missing a URL`,
      );
    }

    return { segment, url };
  });
}
