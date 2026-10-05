import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { constants } from "node:fs";
import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { CatalogItemError } from "./catalog-item-error";
import {
  bucketKeyToLocalPath,
  localPathToBucketKey,
} from "@/lib/catalog-paths";

async function getS3Client(): Promise<S3Client> {
  const { s3Client } = await import("@/lib/s3");
  return s3Client;
}

function requireBucketName() {
  const bucket = process.env.AWS_BUCKET_NAME;

  if (!bucket) {
    throw new Error("AWS_BUCKET_NAME must be set");
  }

  return bucket;
}

async function fileExists(filePath: string) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function catalogObjectExists(key: string) {
  const s3Client = await getS3Client();

  try {
    await s3Client.send(
      new HeadObjectCommand({
        Bucket: requireBucketName(),
        Key: key,
      }),
    );
    return true;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "name" in error &&
      (error.name === "NotFound" || error.name === "NoSuchKey")
    ) {
      return false;
    }

    if (
      typeof error === "object" &&
      error !== null &&
      "$metadata" in error &&
      typeof error.$metadata === "object" &&
      error.$metadata !== null &&
      "httpStatusCode" in error.$metadata &&
      error.$metadata.httpStatusCode === 404
    ) {
      return false;
    }

    throw error;
  }
}

export async function* listCatalogKeyPages(
  prefix: string,
  onProgress?: (message: string) => void,
) {
  const s3Client = await getS3Client();
  const bucket = requireBucketName();
  let continuationToken: string | undefined;
  let page = 0;
  let listed = 0;

  do {
    page += 1;
    onProgress?.(`Listing bucket page ${page}: ${prefix}`);
    const response = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix.endsWith("/") ? prefix : `${prefix}/`,
        ContinuationToken: continuationToken,
      }),
    );

    const keys: string[] = [];
    for (const object of response.Contents ?? []) {
      if (object.Key && !object.Key.endsWith("/")) {
        keys.push(object.Key);
      }
    }

    continuationToken = response.IsTruncated
      ? response.NextContinuationToken
      : undefined;
    listed += keys.length;
    onProgress?.(
      `Listed page ${page}: ${keys.length} objects (${listed} listed so far)`,
    );
    yield keys.sort();
  } while (continuationToken);
}

export async function listCatalogKeys(
  prefix: string,
  onProgress?: (message: string) => void,
) {
  const keys: string[] = [];
  for await (const page of listCatalogKeyPages(prefix, onProgress)) {
    keys.push(...page);
  }
  return keys.sort();
}

async function readCatalogObject(key: string) {
  const s3Client = await getS3Client();
  const response = await s3Client.send(
    new GetObjectCommand({
      Bucket: requireBucketName(),
      Key: key,
    }),
  );

  const body = response.Body;
  if (!body) {
    throw new Error(`Empty body for s3://${requireBucketName()}/${key}`);
  }

  return Buffer.from(await body.transformToByteArray());
}

export async function readCatalogJson(key: string): Promise<unknown> {
  const bytes = await readCatalogObject(key);
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new CatalogItemError(`Invalid catalog JSON: ${key}`, {
      cause: error,
    });
  }
}

export async function downloadCatalogObject(key: string, localPath: string) {
  const bytes = await readCatalogObject(key);
  await mkdir(path.dirname(localPath), { recursive: true });
  await writeFile(localPath, bytes);
}

export async function putCatalogObject(
  key: string,
  body: string | Buffer | Uint8Array,
  options: { skipExisting?: boolean; contentType?: string } = {},
) {
  if (options.skipExisting !== false && (await catalogObjectExists(key))) {
    return { uploaded: false, skipped: true };
  }

  const s3Client = await getS3Client();
  await s3Client.send(
    new PutObjectCommand({
      Bucket: requireBucketName(),
      Key: key,
      Body: body,
      ContentType: options.contentType ?? "application/json",
    }),
  );

  return { uploaded: true, skipped: false };
}

export async function deleteCatalogObject(key: string) {
  const s3Client = await getS3Client();
  await s3Client.send(
    new DeleteObjectCommand({ Bucket: requireBucketName(), Key: key }),
  );
}

export async function uploadCatalogObject(
  localPath: string,
  key: string,
  options: { skipExisting?: boolean } = {},
) {
  const body = await readFile(localPath);
  return putCatalogObject(key, body, options);
}

async function discoverLocalFiles(dir: string): Promise<string[]> {
  if (!(await fileExists(dir))) {
    return [];
  }

  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === "vectors" || entry.name === "runs") {
        continue;
      }

      files.push(...(await discoverLocalFiles(entryPath)));
      continue;
    }

    if (entry.isFile() && /^\d+\.json$/.test(entry.name)) {
      files.push(entryPath);
    }
  }

  return files.sort();
}

export async function syncCatalogPrefixDown(options: {
  prefix: string;
  localRoot?: string;
  skipExistingLocal?: boolean;
  onProgress?: (message: string) => void;
}) {
  const localRoot = options.localRoot ?? "data/auctionet/items";
  const startedAt = Date.now();
  const keys = await listCatalogKeys(options.prefix, options.onProgress);
  const itemKeys = keys.filter(
    (key) => !key.includes("/vectors/") || options.prefix.includes("/vectors"),
  );
  options.onProgress?.(
    `Listing complete: ${itemKeys.length} files to check (${keys.length - itemKeys.length} vector objects excluded)`,
  );
  let downloaded = 0;
  let skipped = 0;

  for (const key of itemKeys) {
    const localPath = bucketKeyToLocalPath(key, localRoot);

    if (options.skipExistingLocal !== false && (await fileExists(localPath))) {
      skipped += 1;
    } else {
      options.onProgress?.(
        `Downloading ${downloaded + skipped + 1}/${itemKeys.length}: ${key}`,
      );
      await downloadCatalogObject(key, localPath);
      downloaded += 1;
      options.onProgress?.(`Saved: ${localPath}`);
    }

    const done = downloaded + skipped;
    if (done === 1 || done % 100 === 0 || done === itemKeys.length) {
      options.onProgress?.(
        `Sync progress: ${done}/${itemKeys.length} (${Math.round((done / itemKeys.length) * 100)}%) — ${downloaded} downloaded, ${skipped} already local, ${Math.round((Date.now() - startedAt) / 1000)}s elapsed`,
      );
    }
  }

  return { downloaded, skipped, total: keys.length };
}

/** One local path per bucket key — keeps concurrent workers from double-putting. */
function uniqueFilesByBucketKey(files: string[], localRoot: string) {
  const byKey = new Map<string, string>();

  for (const localPath of files) {
    const key = localPathToBucketKey(localPath, localRoot);
    if (!byKey.has(key)) {
      byKey.set(key, localPath);
    }
  }

  return [...byKey.entries()].map(([key, localPath]) => ({ key, localPath }));
}

async function uploadFilesConcurrently(options: {
  files: string[];
  localRoot: string;
  skipExistingRemote?: boolean;
  concurrency?: number;
  onProgress?: (done: number, total: number) => void;
}) {
  const entries = uniqueFilesByBucketKey(options.files, options.localRoot);
  const concurrency = Math.max(1, options.concurrency ?? 1);
  let nextIndex = 0;
  let uploaded = 0;
  let skipped = 0;
  let done = 0;

  async function worker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;

      if (index >= entries.length) {
        return;
      }

      const entry = entries[index];
      const result = await uploadCatalogObject(entry.localPath, entry.key, {
        skipExisting: options.skipExistingRemote !== false,
      });

      if (result.skipped) {
        skipped += 1;
      } else {
        uploaded += 1;
      }

      done += 1;
      options.onProgress?.(done, entries.length);
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, Math.max(entries.length, 1)) },
      () => worker(),
    ),
  );

  return { uploaded, skipped, total: entries.length };
}

export async function syncCatalogDirUp(options: {
  localDir: string;
  localRoot?: string;
  skipExistingRemote?: boolean;
  concurrency?: number;
  onProgress?: (done: number, total: number) => void;
}) {
  const localRoot = options.localRoot ?? "data/auctionet/items";
  const files = await discoverLocalFiles(options.localDir);

  return uploadFilesConcurrently({
    files,
    localRoot,
    skipExistingRemote: options.skipExistingRemote,
    concurrency: options.concurrency,
    onProgress: options.onProgress,
  });
}

export async function syncVectorsDirUp(options: {
  vectorsDir: string;
  localRoot?: string;
  skipExistingRemote?: boolean;
  concurrency?: number;
  onProgress?: (done: number, total: number) => void;
}) {
  const localRoot = options.localRoot ?? "data/auctionet/items";

  if (!(await fileExists(options.vectorsDir))) {
    return { uploaded: 0, skipped: 0, total: 0 };
  }

  const files: string[] = [];

  async function walk(dir: string) {
    const dirEntries = await readdir(dir, { withFileTypes: true });

    for (const entry of dirEntries) {
      const entryPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        await walk(entryPath);
      } else if (entry.isFile() && /^\d+\.json$/.test(entry.name)) {
        files.push(entryPath);
      }
    }
  }

  await walk(options.vectorsDir);
  files.sort();

  return uploadFilesConcurrently({
    files,
    localRoot,
    skipExistingRemote: options.skipExistingRemote,
    concurrency: options.concurrency,
    onProgress: options.onProgress,
  });
}
