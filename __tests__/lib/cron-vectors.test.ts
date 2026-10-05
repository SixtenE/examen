// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { indexCategory, parseArgs } from "../../scripts/cron";
import * as embedding from "../../scripts/embed";
import * as upsert from "../../scripts/upsert";
import {
  catalogObjectExists,
  deleteCatalogObject,
  listCatalogKeyPages,
  readCatalogJson,
  putCatalogObject,
} from "@/lib/catalog-bucket";
import { qdrantClient } from "@/lib/qdrant";
import { CatalogItemError } from "@/lib/catalog-item-error";

vi.mock("@/lib/catalog-bucket", () => ({
  catalogObjectExists: vi.fn(),
  deleteCatalogObject: vi.fn(),
  listCatalogKeyPages: vi.fn(),
  readCatalogJson: vi.fn(),
  putCatalogObject: vi.fn(),
}));
vi.mock("@/lib/qdrant", () => ({
  qdrantClient: {
    retrieve: vi.fn(),
    upsert: vi.fn(),
    collectionExists: vi.fn(),
  },
}));
const category = {
  segment: "28-paintings",
  url: "https://auctionet.com/en/search/28-paintings",
};
const itemKey = "scrape/28-paintings/100/10001.json";
const vectorKey = "scrape/28-paintings/vectors/100/10001.json";
const failureKey = "scrape/28-paintings/failures/100/10001.json";
const item = {
  auctionet_id: 10001,
  status: "sold",
  title: "Painting",
  price: "1 250 SEK",
  currency: "SEK",
  metadata: { vip_data_item: { ends_at: 1700000000 } },
  image_urls: [
    "https://images.auctionet.com/1.jpg",
    "https://images.auctionet.com/2.jpg",
  ],
};
function artifact(id = item.auctionet_id) {
  return {
    auctionet_id: id,
    source_url: null,
    title: "Painting",
    embedded_at: "2026-10-03T00:00:00Z",
    model: "google/gemini-embedding-2",
    dimensions: 3072,
    references: item.image_urls.map((url, index) => ({
      image_index: index,
      image_url: url,
      embedding: Array(3072).fill(0.1),
    })),
  };
}
const objects = new Map<string, unknown>();
const options = () => ({
  stages: new Set<"embed" | "store" | "upsert">(["embed", "store", "upsert"]),
  dryRun: false,
  force: false,
  retryFailed: false,
  maxItems: null,
});

beforeEach(() => {
  vi.resetAllMocks();
  objects.clear();
  objects.set(itemKey, item);
  vi.mocked(listCatalogKeyPages).mockImplementation(
    async function* (prefix, log) {
      log?.("Listing bucket page 1");
      yield [...objects.keys()]
        .filter((key) => key.startsWith(`${prefix}/`))
        .sort();
    },
  );
  vi.mocked(catalogObjectExists).mockImplementation(async (key) =>
    objects.has(key),
  );
  vi.mocked(readCatalogJson).mockImplementation(async (key) => {
    if (!objects.has(key)) throw new Error(`Missing bucket object: ${key}`);
    return objects.get(key);
  });
  vi.mocked(putCatalogObject).mockImplementation(async (key, body) => {
    objects.set(key, JSON.parse(String(body)));
    return { uploaded: true, skipped: false };
  });
  vi.mocked(deleteCatalogObject).mockImplementation(async (key) => {
    objects.delete(key);
  });
  vi.mocked(qdrantClient.retrieve).mockResolvedValue([]);
  vi.mocked(qdrantClient.upsert).mockResolvedValue({
    operation_id: 1,
    status: "completed",
  });
  vi.mocked(qdrantClient.collectionExists).mockResolvedValue({ exists: true });
  vi.spyOn(embedding, "embedAuctionetItem").mockImplementation(async (value) =>
    artifact(value.auctionet_id),
  );
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

it("uploads each completed artifact before upsert, preserves metadata, and logs progress", async () => {
  expect(
    await indexCategory(category, options(), { remaining: 1 }),
  ).toMatchObject({ embedded: 1, indexed: 1, images: 2, failed: 0 });
  expect(putCatalogObject).toHaveBeenCalledWith(vectorKey, expect.any(String));
  expect(vi.mocked(putCatalogObject).mock.invocationCallOrder[0]).toBeLessThan(
    vi.mocked(qdrantClient.upsert).mock.invocationCallOrder[0],
  );
  expect(qdrantClient.upsert).toHaveBeenCalledWith("references-28-paintings", {
    wait: true,
    points: [0, 1].map((index) => ({
      id: 1000100 + index,
      vector: Array(3072).fill(0.1),
      payload: expect.objectContaining({
        auctionet_id: "10001",
        image_index: index,
        price: 1250,
        sold_at: 1700000000,
        title: "Painting",
      }),
    })),
  });
  expect(console.log).toHaveBeenCalledWith(
    expect.stringContaining("vector artifact saved in bucket"),
  );
  expect(console.log).toHaveBeenCalledWith(
    expect.stringContaining("Progress: 1 checked"),
  );
});

it("skips fully indexed items without reading or creating vector artifacts", async () => {
  vi.mocked(qdrantClient.retrieve).mockResolvedValue([
    { id: 1000100 },
    { id: 1000101 },
  ]);
  const budget = { remaining: 1 };
  expect(await indexCategory(category, options(), budget)).toMatchObject({
    skipped: 1,
    embedded: 0,
  });
  expect(budget.remaining).toBe(1);
  expect(catalogObjectExists).not.toHaveBeenCalled();
  expect(embedding.embedAuctionetItem).not.toHaveBeenCalled();
  expect(qdrantClient.upsert).not.toHaveBeenCalled();
});

it("reuses saved vectors to repair partial Qdrant points without embedding", async () => {
  objects.set(vectorKey, artifact());
  vi.mocked(qdrantClient.retrieve).mockResolvedValue([{ id: 1000100 }]);
  expect(
    await indexCategory(category, options(), { remaining: 1 }),
  ).toMatchObject({ reused: 1, indexed: 1, embedded: 0 });
  expect(embedding.embedAuctionetItem).not.toHaveBeenCalled();
  expect(putCatalogObject).not.toHaveBeenCalled();
});

it("resumes from the bucket after a failed Qdrant write", async () => {
  const seed = vi
    .spyOn(upsert, "upsertArtifact")
    .mockRejectedValueOnce(new Error("Qdrant unavailable"));
  await expect(
    indexCategory(category, options(), { remaining: 1 }),
  ).rejects.toThrow("Qdrant unavailable");
  expect(objects.has(vectorKey)).toBe(true);
  expect(objects.has(failureKey)).toBe(false);
  seed.mockRestore();
  expect(
    await indexCategory(category, options(), { remaining: 1 }),
  ).toMatchObject({ reused: 1, indexed: 1, embedded: 0 });
  expect(embedding.embedAuctionetItem).toHaveBeenCalledTimes(1);
});

it("stops on an upload failure before upsert or any further embeddings", async () => {
  objects.set("scrape/28-paintings/100/10002.json", {
    ...item,
    auctionet_id: 10002,
  });
  vi.mocked(putCatalogObject).mockRejectedValue(
    new Error("Bucket unavailable"),
  );
  const budget = { remaining: 2 };
  await expect(indexCategory(category, options(), budget)).rejects.toThrow(
    "Bucket unavailable",
  );
  expect(qdrantClient.upsert).not.toHaveBeenCalled();
  expect(embedding.embedAuctionetItem).toHaveBeenCalledTimes(1);
  expect(budget.remaining).toBe(1);
});

it("does not treat a bucket check failure as a missing artifact", async () => {
  vi.mocked(catalogObjectExists).mockRejectedValue(new Error("Access denied"));
  await expect(
    indexCategory(category, options(), { remaining: 1 }),
  ).rejects.toThrow("Access denied");
  expect(embedding.embedAuctionetItem).not.toHaveBeenCalled();
});

it("records a failed embedding in the bucket and counts it against the budget", async () => {
  vi.mocked(embedding.embedAuctionetItem).mockRejectedValueOnce(
    new Error("Embedding failed"),
  );
  const budget = { remaining: 1 };
  await expect(indexCategory(category, options(), budget)).rejects.toThrow(
    "Embedding failed",
  );
  expect(budget.remaining).toBe(0);
  expect(objects.has(vectorKey)).toBe(false);
  expect(objects.get(failureKey)).toEqual({
    item_key: itemKey,
    failed_at: expect.any(String),
    error: "Embedding failed",
  });
  expect(putCatalogObject).toHaveBeenCalledWith(
    failureKey,
    expect.any(String),
    { skipExisting: false },
  );
  expect(qdrantClient.upsert).not.toHaveBeenCalled();
});

it("shares the embedding budget across categories, excluding reused and unsold items", async () => {
  objects.set(vectorKey, artifact());
  objects.set("scrape/28-paintings/100/10002.json", {
    ...item,
    auctionet_id: 10002,
    status: "unsold",
  });
  objects.set("scrape/28-paintings/100/10003.json", {
    ...item,
    auctionet_id: 10003,
  });
  objects.set("scrape/28-paintings/100/10004.json", {
    ...item,
    auctionet_id: 10004,
  });
  objects.set("scrape/6-glass/100/10005.json", {
    ...item,
    auctionet_id: 10005,
  });
  objects.set("scrape/6-glass/100/10006.json", {
    ...item,
    auctionet_id: 10006,
  });
  const budget = { remaining: 3 };
  expect(await indexCategory(category, options(), budget)).toMatchObject({
    embedded: 2,
    reused: 1,
    unsold: 1,
  });
  expect(budget.remaining).toBe(1);
  expect(
    await indexCategory({ ...category, segment: "6-glass" }, options(), budget),
  ).toMatchObject({ checked: 1, embedded: 1 });
  expect(budget.remaining).toBe(0);
  expect(readCatalogJson).not.toHaveBeenCalledWith(
    "scrape/6-glass/100/10006.json",
  );
});

it("does not request the next listing page after reaching the embedding budget", async () => {
  const nextPage = vi.fn();
  vi.mocked(listCatalogKeyPages).mockImplementation(async function* (prefix) {
    if (prefix.endsWith("/failures")) return;
    yield [itemKey, vectorKey, "scrape/28-paintings/runs/123.json"];
    nextPage();
    yield [];
  });
  await indexCategory(category, options(), { remaining: 1 });
  expect(nextPage).not.toHaveBeenCalled();
});

it("supports independent category workers with separate collections and budgets", async () => {
  objects.set("scrape/6-glass/100/10001.json", item);
  const paintingBudget = { remaining: 1 };
  const glassBudget = { remaining: 1 };
  await Promise.all([
    indexCategory(category, options(), paintingBudget),
    indexCategory({ ...category, segment: "6-glass" }, options(), glassBudget),
  ]);
  expect(objects.has(vectorKey)).toBe(true);
  expect(objects.has("scrape/6-glass/vectors/100/10001.json")).toBe(true);
  expect(qdrantClient.upsert).toHaveBeenCalledWith(
    "references-6-glass",
    expect.anything(),
  );
  expect(paintingBudget.remaining).toBe(0);
  expect(glassBudget.remaining).toBe(0);
});

it("dry-run reads bucket and Qdrant, but never embeds, writes, or upserts", async () => {
  objects.set("scrape/28-paintings/100/10002.json", {
    ...item,
    auctionet_id: 10002,
  });
  objects.set(vectorKey, artifact());
  expect(
    await indexCategory(
      category,
      { ...options(), dryRun: true },
      { remaining: 1 },
    ),
  ).toMatchObject({ reused: 1, embedded: 1 });
  expect(qdrantClient.retrieve).toHaveBeenCalled();
  expect(embedding.embedAuctionetItem).not.toHaveBeenCalled();
  expect(putCatalogObject).not.toHaveBeenCalled();
  expect(qdrantClient.upsert).not.toHaveBeenCalled();
});

it("dry-run handles a missing collection without creating it or retrieving missing points", async () => {
  vi.mocked(qdrantClient.collectionExists).mockResolvedValue({ exists: false });
  await indexCategory(
    category,
    { ...options(), dryRun: true },
    { remaining: 1 },
  );
  expect(qdrantClient.retrieve).not.toHaveBeenCalled();
  expect(qdrantClient.upsert).not.toHaveBeenCalled();
});

it("embed/store runs require no Qdrant access and immediately save vectors", async () => {
  const stages = new Set<"embed" | "store" | "upsert">(["embed", "store"]);
  await indexCategory(category, { ...options(), stages }, { remaining: 1 });
  expect(putCatalogObject).toHaveBeenCalled();
  expect(qdrantClient.retrieve).not.toHaveBeenCalled();
  expect(qdrantClient.upsert).not.toHaveBeenCalled();
});

it("upsert-only reads bucket artifacts and preserves force and max-items", async () => {
  objects.set(vectorKey, artifact());
  objects.set("scrape/28-paintings/100/10002.json", {
    ...item,
    auctionet_id: 10002,
  });
  objects.set("scrape/28-paintings/vectors/100/10002.json", artifact(10002));
  vi.mocked(qdrantClient.retrieve).mockResolvedValue([
    { id: 1000100 },
    { id: 1000101 },
  ]);
  const stages = new Set<"embed" | "store" | "upsert">(["upsert"]);
  expect(
    await indexCategory(
      category,
      { ...options(), stages, force: true, maxItems: 1 },
      { remaining: null },
    ),
  ).toMatchObject({ checked: 1, indexed: 1, embedded: 0 });
  expect(qdrantClient.upsert).toHaveBeenCalledTimes(1);
  expect(embedding.embedAuctionetItem).not.toHaveBeenCalled();
});

it("quarantines mismatched bucket artifacts instead of paying to replace them", async () => {
  objects.set(vectorKey, artifact(999));
  await expect(
    indexCategory(category, options(), { remaining: 1 }),
  ).resolves.toMatchObject({ failed: 1, embedded: 0, indexed: 0 });
  expect(objects.get(failureKey)).toMatchObject({ permanent: true });
  expect(embedding.embedAuctionetItem).not.toHaveBeenCalled();
  expect(qdrantClient.upsert).not.toHaveBeenCalled();
});

it("rejects cron embedding without a durable store stage", () => {
  expect(() => parseArgs(["--stages", "embed,upsert"])).toThrow(
    "requires --stages embed,store",
  );
  expect(
    parseArgs(["--stages", "embed,store", "--category", "6-glass"])
      .categoryArgs,
  ).toEqual(["6-glass"]);
});

it("retries only bucket failures and deletes the record after saving vectors", async () => {
  objects.set("scrape/28-paintings/100/10002.json", {
    ...item,
    auctionet_id: 10002,
  });
  vi.mocked(embedding.embedAuctionetItem).mockRejectedValueOnce(
    new Error("Bad image"),
  );
  await expect(
    indexCategory(category, options(), { remaining: 1 }),
  ).rejects.toThrow("Bad image");
  expect(objects.has(failureKey)).toBe(true);
  expect(
    await indexCategory(
      category,
      { ...options(), retryFailed: true },
      { remaining: 2 },
    ),
  ).toMatchObject({ checked: 1, embedded: 1, failed: 0 });
  expect(objects.has(failureKey)).toBe(false);
  expect(readCatalogJson).not.toHaveBeenCalledWith(
    "scrape/28-paintings/100/10002.json",
  );
  expect(deleteCatalogObject).toHaveBeenCalledWith(failureKey);
  const vectorWrite = vi.mocked(putCatalogObject).mock.invocationCallOrder[1];
  expect(vectorWrite).toBeLessThan(
    vi.mocked(deleteCatalogObject).mock.invocationCallOrder[0],
  );
  expect(
    await indexCategory(
      category,
      { ...options(), retryFailed: true },
      { remaining: 1 },
    ),
  ).toMatchObject({ checked: 0 });
});

it("keeps a failure on another failed retry and updates its error", async () => {
  objects.set(failureKey, { error: "Old error" });
  vi.mocked(embedding.embedAuctionetItem).mockRejectedValueOnce(
    new Error("Still failing"),
  );
  await expect(
    indexCategory(
      category,
      { ...options(), retryFailed: true },
      { remaining: 1 },
    ),
  ).rejects.toThrow("Still failing");
  expect(objects.get(failureKey)).toMatchObject({ error: "Still failing" });
  expect(deleteCatalogObject).not.toHaveBeenCalled();
});

it.each(["saved", "indexed"])(
  "clears %s embedding failures without paying to embed again",
  async (state) => {
    objects.set(failureKey, { error: "Old error" });
    if (state === "saved") objects.set(vectorKey, artifact());
    else
      vi.mocked(qdrantClient.retrieve).mockResolvedValue([
        { id: 1000100 },
        { id: 1000101 },
      ]);
    await indexCategory(
      category,
      { ...options(), retryFailed: true },
      { remaining: 1 },
    );
    expect(objects.has(failureKey)).toBe(false);
    expect(embedding.embedAuctionetItem).not.toHaveBeenCalled();
  },
);

it("a successful embedding clears the failure even if the following Qdrant write fails", async () => {
  objects.set(failureKey, { error: "Old error" });
  vi.spyOn(upsert, "upsertArtifact").mockRejectedValueOnce(
    new Error("Qdrant unavailable"),
  );
  await expect(
    indexCategory(
      category,
      { ...options(), retryFailed: true },
      { remaining: 1 },
    ),
  ).rejects.toThrow("Qdrant unavailable");
  expect(objects.has(vectorKey)).toBe(true);
  expect(objects.has(failureKey)).toBe(false);
});

it("dry-run retries leave failure records untouched on both successful plans and errors", async () => {
  objects.set(failureKey, { error: "Old error" });
  const retryOptions = { ...options(), retryFailed: true, dryRun: true };
  await indexCategory(category, retryOptions, { remaining: 1 });
  objects.set(itemKey, {});
  await expect(
    indexCategory(category, retryOptions, { remaining: 1 }),
  ).resolves.toMatchObject({ failed: 1 });
  expect(objects.get(failureKey)).toEqual({ error: "Old error" });
  expect(putCatalogObject).not.toHaveBeenCalled();
  expect(deleteCatalogObject).not.toHaveBeenCalled();
});

it.each([1, 2])(
  "continues past permanent image failures across runs with an embedding budget of %i",
  async (limit) => {
    objects.set("scrape/28-paintings/100/10002.json", {
      ...item,
      auctionet_id: 10002,
    });
    vi.mocked(embedding.embedAuctionetItem).mockImplementation(
      async (value) => {
        if (value.auctionet_id === item.auctionet_id)
          throw new CatalogItemError("Broken image");
        return artifact(value.auctionet_id);
      },
    );
    expect(
      await indexCategory(category, options(), { remaining: limit }),
    ).toMatchObject({ failed: 1, indexed: limit - 1 });
    expect(objects.get(failureKey)).toMatchObject({ permanent: true });
    expect(
      await indexCategory(category, options(), { remaining: 1 }),
    ).toMatchObject({ failed: 0, skipped: 1, indexed: 1 });
    expect(
      vi
        .mocked(embedding.embedAuctionetItem)
        .mock.calls.filter(
          ([value]) => value.auctionet_id === item.auctionet_id,
        ),
    ).toHaveLength(1);

    vi.mocked(embedding.embedAuctionetItem).mockImplementation(async (value) =>
      artifact(value.auctionet_id),
    );
    expect(
      await indexCategory(
        category,
        { ...options(), retryFailed: true },
        { remaining: 1 },
      ),
    ).toMatchObject({ checked: 1, indexed: 1, failed: 0 });
    expect(objects.has(failureKey)).toBe(false);
  },
);

it("continues to a valid item after quarantining malformed catalog data", async () => {
  objects.set(itemKey, {});
  objects.set("scrape/28-paintings/100/10002.json", {
    ...item,
    auctionet_id: 10002,
  });
  expect(
    await indexCategory(category, options(), { remaining: 1 }),
  ).toMatchObject({ checked: 2, failed: 1, indexed: 1 });
  expect(objects.get(failureKey)).toMatchObject({ permanent: true });
});

it("preserves the failure and saved vectors if clearing the bucket record fails", async () => {
  objects.set(failureKey, { error: "Old error" });
  vi.mocked(deleteCatalogObject).mockRejectedValueOnce(
    new Error("Delete denied"),
  );
  await expect(
    indexCategory(
      category,
      { ...options(), retryFailed: true },
      { remaining: 1 },
    ),
  ).rejects.toThrow("Delete denied");
  expect(objects.has(vectorKey)).toBe(true);
  expect(objects.has(failureKey)).toBe(true);
  expect(qdrantClient.upsert).not.toHaveBeenCalled();
});

it("retry CLI defaults to embed/store/upsert and rejects scrape or missing embed", () => {
  expect(parseArgs(["--retry-failed"])).toMatchObject({
    retryFailed: true,
    stages: new Set(["embed", "store", "upsert"]),
  });
  expect(() =>
    parseArgs(["--retry-failed", "--stages", "scrape,embed,store"]),
  ).toThrow("cannot include scrape");
  expect(() => parseArgs(["--retry-failed", "--stages", "upsert"])).toThrow(
    "requires the embed stage",
  );
});
