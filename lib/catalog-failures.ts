import {
  deleteCatalogObject,
  listCatalogKeyPages,
  putCatalogObject,
} from "./catalog-bucket";
import { categoryBucketPrefix } from "./catalog-paths";

export function categoryFailuresBucketPrefix(segment: string) {
  return `${categoryBucketPrefix(segment)}/failures`;
}

function failureBucketKey(itemKey: string) {
  const match = /^scrape\/([^/]+)\/(\d+\/\d+\.json)$/.exec(itemKey);
  if (!match) throw new Error(`Invalid catalog item key: ${itemKey}`);
  return `${categoryFailuresBucketPrefix(match[1])}/${match[2]}`;
}

export async function listFailedCatalogItems(
  segment: string,
  onProgress?: (message: string) => void,
) {
  const prefix = categoryFailuresBucketPrefix(segment);
  const items = new Set<string>();
  for await (const page of listCatalogKeyPages(prefix, onProgress)) {
    for (const key of page) {
      const relative = key.slice(prefix.length + 1);
      if (key.startsWith(`${prefix}/`) && /^\d+\/\d+\.json$/.test(relative)) {
        items.add(`${categoryBucketPrefix(segment)}/${relative}`);
      }
    }
  }
  return items;
}

export async function recordCatalogFailure(itemKey: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  try {
    await putCatalogObject(
      failureBucketKey(itemKey),
      `${JSON.stringify({ item_key: itemKey, failed_at: new Date().toISOString(), error: message })}\n`,
      { skipExisting: false },
    );
  } catch (bucketError) {
    throw new Error(
      `Could not record failure for ${itemKey} (${message}): ${bucketError instanceof Error ? bucketError.message : String(bucketError)}`,
      { cause: bucketError },
    );
  }
}

export async function clearCatalogFailure(itemKey: string) {
  await deleteCatalogObject(failureBucketKey(itemKey));
}
