import path from "node:path";

export const CATALOG_BUCKET_PREFIX = "catalog/auctionet/items";
export const LOCAL_CATALOG_ROOT = "data/auctionet/items";
export const CATEGORY_SEGMENT_PATTERN = /^\d+-[a-z0-9-]+$/;
export const MAX_REFERENCES_PER_ITEM = 100;

export type CatalogCategory = {
  segment: string;
  url: string;
};

export const DEFAULT_CATALOG_CATEGORIES: CatalogCategory[] = [
  {
    segment: "9-ceramics-porcelain",
    url: "https://auctionet.com/en/search/9-ceramics-porcelain?is=ended",
  },
  {
    segment: "28-paintings",
    url: "https://auctionet.com/en/search/28-paintings?is=ended",
  },
];

export function assertCategorySegment(segment: string) {
  if (!CATEGORY_SEGMENT_PATTERN.test(segment)) {
    throw new Error(
      `Invalid Auctionet Category segment: ${segment} (expected like 9-ceramics-porcelain)`,
    );
  }

  return segment;
}

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

/** Maps a local catalog file to its durable bucket key. */
export function localPathToBucketKey(localPath: string, localRoot = LOCAL_CATALOG_ROOT) {
  const absoluteLocal = path.resolve(localPath);
  const absoluteRoot = path.resolve(localRoot);
  const relative = path.relative(absoluteRoot, absoluteLocal);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${localPath} is outside catalog root ${localRoot}`);
  }

  return `${CATALOG_BUCKET_PREFIX}/${relative.split(path.sep).join("/")}`;
}

export function bucketKeyToLocalPath(key: string, localRoot = LOCAL_CATALOG_ROOT) {
  const prefix = `${CATALOG_BUCKET_PREFIX}/`;

  if (!key.startsWith(prefix)) {
    throw new Error(`${key} is outside catalog bucket prefix ${CATALOG_BUCKET_PREFIX}`);
  }

  return path.join(localRoot, ...key.slice(prefix.length).split("/"));
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
        url: `https://auctionet.com/en/search/${segment}?is=ended`,
      };
    }

    const segment = assertCategorySegment(trimmed.slice(0, separator).trim());
    const url = trimmed.slice(separator + 1).trim();

    if (!url) {
      throw new Error(`CATALOG_CATEGORIES entry for ${segment} is missing a URL`);
    }

    return { segment, url };
  });
}
