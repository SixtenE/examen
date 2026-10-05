// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  embedItem,
  embedAuctionetVectors,
  parseArgs,
} from "../../scripts/embed";
import {
  deleteCatalogObject,
  listCatalogKeyPages,
  putCatalogObject,
} from "../../lib/catalog-bucket";

const retrieve = vi.hoisted(() => vi.fn());
vi.mock("@/lib/qdrant", () => ({ qdrantClient: { retrieve } }));
vi.mock("@/lib/catalog-bucket", () => ({
  deleteCatalogObject: vi.fn(),
  listCatalogKeyPages: vi.fn(),
  putCatalogObject: vi.fn(),
}));
const bucketObjects = new Map<string, unknown>();
beforeEach(() => {
  vi.stubEnv("OPENROUTER_API_KEY", "test");
  bucketObjects.clear();
  vi.mocked(listCatalogKeyPages).mockImplementation(async function* (prefix) {
    yield [...bucketObjects.keys()].filter((key) =>
      key.startsWith(`${prefix}/`),
    );
  });
  vi.mocked(putCatalogObject).mockImplementation(async (key, body) => {
    bucketObjects.set(key, JSON.parse(String(body)));
    return { uploaded: true, skipped: false };
  });
  vi.mocked(deleteCatalogObject).mockImplementation(async (key) => {
    bucketObjects.delete(key);
  });
});
const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  await Promise.all(
    directories
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

it.each([true, false])(
  "fresh disk: fully indexed=%s avoids only redundant embedding",
  async (indexed) => {
    const root = await mkdtemp(path.join(tmpdir(), "embed-resume-"));
    directories.push(root);
    const itemsDir = path.join(root, "28-paintings");
    const outDir = path.join(itemsDir, "vectors");
    await mkdir(itemsDir);
    const itemPath = path.join(itemsDir, "123456.json");
    const outputPath = path.join(outDir, "123456.json");
    await writeFile(
      itemPath,
      JSON.stringify({
        auctionet_id: 123456,
        status: "sold",
        image_urls: ["https://example.com/1.jpg", "https://example.com/2.jpg"],
      }),
    );
    retrieve.mockResolvedValue(
      indexed ? [{ id: 12345600 }, { id: 12345601 }] : [{ id: 12345600 }],
    );
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [0, 1].map(() => ({ embedding: Array(3072).fill(0.1) })),
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await embedItem(itemPath, outputPath, {
      itemsDir,
      outDir,
      skipIndexed: true,
      retryFailed: false,
      force: false,
      dryRun: false,
      maxItems: null,
      batchSize: 5,
      delayMs: 0,
      maxRetries: 0,
    });
    expect(retrieve).toHaveBeenCalledWith("references-28-paintings", {
      ids: [12345600, 12345601],
      with_payload: false,
      with_vector: false,
    });
    expect(result.skipped).toBe(indexed);
    expect(fetchMock).toHaveBeenCalledTimes(indexed ? 0 : 1);
    if (indexed) {
      await expect(readFile(outputPath)).rejects.toMatchObject({
        code: "ENOENT",
      });
    } else {
      expect(
        JSON.parse(await readFile(outputPath, "utf8")).references,
      ).toHaveLength(2);
    }
  },
);

it("embeds 100 new items with all five images, skips existing items, and resumes next run", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "embed-budget-"));
  directories.push(root);
  const itemsDir = path.join(root, "28-paintings");
  const outDir = path.join(itemsDir, "vectors");
  await mkdir(outDir, { recursive: true });
  for (let id = 100; id < 204; id++) {
    await writeFile(
      path.join(itemsDir, `${id}.json`),
      JSON.stringify({
        auctionet_id: id,
        status: id === 100 ? "unsold" : "sold",
        image_urls: Array.from(
          { length: 5 },
          (_, i) => `https://example.com/${id}/${i}.jpg`,
        ),
      }),
    );
  }
  await writeFile(path.join(outDir, "101.json"), "{}");
  retrieve.mockImplementation(async (_collection, { ids }) =>
    ids[0] === 10200 ? ids.map((id: number) => ({ id })) : [],
  );
  vi.stubEnv("OPENROUTER_API_KEY", "test");
  const fetchMock = vi.fn().mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          data: Array.from({ length: 5 }, () => ({
            embedding: Array(3072).fill(0.1),
          })),
        }),
      ),
  );
  vi.stubGlobal("fetch", fetchMock);
  const options = {
    itemsDir,
    outDir,
    skipIndexed: true,
    retryFailed: false,
    force: false,
    dryRun: false,
    maxItems: 100,
    batchSize: 5,
    delayMs: 0,
    maxRetries: 0,
  };
  expect(await embedAuctionetVectors(options)).toMatchObject({
    embedded: 100,
    images: 500,
    failed: 0,
  });
  expect(fetchMock).toHaveBeenCalledTimes(100);
  await expect(readFile(path.join(outDir, "203.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  expect(await embedAuctionetVectors(options)).toMatchObject({
    embedded: 1,
    images: 5,
    failed: 0,
  });
  expect(fetchMock).toHaveBeenCalledTimes(101);
});

it("local embedding records failures in the bucket, retries only those items, and clears successes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "embed-failures-"));
  directories.push(root);
  const itemsDir = path.join(root, "28-paintings");
  const outDir = path.join(itemsDir, "vectors");
  await mkdir(itemsDir);
  for (const id of [123456, 123457]) {
    await writeFile(
      path.join(itemsDir, `${id}.json`),
      JSON.stringify({
        auctionet_id: id,
        status: "sold",
        image_urls: ["https://example.com/1.jpg"],
      }),
    );
  }
  vi.stubEnv("OPENROUTER_API_KEY", "test");
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Bad image" }), { status: 400 }),
    );
  vi.stubGlobal("fetch", fetchMock);
  const options = {
    itemsDir,
    outDir,
    skipIndexed: false,
    retryFailed: false,
    force: false,
    dryRun: false,
    maxItems: 1,
    batchSize: 5,
    delayMs: 0,
    maxRetries: 0,
  };
  expect(await embedAuctionetVectors(options)).toMatchObject({ failed: 1 });
  const failureKey = "scrape/28-paintings/failures/123/123456.json";
  expect(bucketObjects.get(failureKey)).toMatchObject({
    item_key: "scrape/28-paintings/123/123456.json",
    error: expect.stringContaining("Bad image"),
  });
  fetchMock.mockResolvedValue(
    new Response(
      JSON.stringify({ data: [{ embedding: Array(3072).fill(0.1) }] }),
    ),
  );
  expect(
    await embedAuctionetVectors({
      ...options,
      retryFailed: true,
      dryRun: true,
    }),
  ).toMatchObject({ embedded: 1 });
  expect(bucketObjects.has(failureKey)).toBe(true);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(
    await embedAuctionetVectors({ ...options, retryFailed: true }),
  ).toMatchObject({ embedded: 1, failed: 0 });
  expect(bucketObjects.has(failureKey)).toBe(false);
  expect(deleteCatalogObject).toHaveBeenCalledWith(failureKey);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  await expect(
    readFile(path.join(outDir, "123457.json")),
  ).rejects.toMatchObject({ code: "ENOENT" });
  expect(
    parseArgs(["--items", itemsDir, "--out", outDir, "--retry-failed"])
      .retryFailed,
  ).toBe(true);
});
