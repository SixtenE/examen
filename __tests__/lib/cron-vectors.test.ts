// @vitest-environment node
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { prepareVectors } from "../../scripts/cron";
import {
  catalogObjectExists,
  downloadCatalogObject,
} from "@/lib/catalog-bucket";
import { categoryItemsDir, categoryVectorsDir } from "@/lib/catalog-paths";
import { qdrantClient } from "@/lib/qdrant";

const scratch = vi.hoisted(() => ({ root: "" }));
vi.mock("@/lib/catalog-paths", async (original) => {
  const actual = await original<typeof import("@/lib/catalog-paths")>();
  return {
    ...actual,
    categoryItemsDir: (segment: string) =>
      actual.categoryItemsDir(segment, scratch.root),
    categoryVectorsDir: (segment: string) =>
      actual.categoryVectorsDir(segment, scratch.root),
    localPathToBucketKey: (file: string) =>
      actual.localPathToBucketKey(file, scratch.root),
  };
});
vi.mock("@/lib/catalog-bucket", () => ({
  catalogObjectExists: vi.fn(),
  downloadCatalogObject: vi.fn(),
}));
vi.mock("@/lib/qdrant", () => ({
  qdrantClient: { retrieve: vi.fn() },
}));

const category = {
  segment: "28-paintings",
  url: "https://auctionet.com/en/search/28-paintings",
};
const item = {
  auctionet_id: 10001,
  status: "sold",
  image_urls: ["https://images.auctionet.com/10001.jpg"],
};
const artifact = JSON.stringify({
  auctionet_id: item.auctionet_id,
  model: "google/gemini-embedding-2",
  dimensions: 3072,
  references: [
    {
      image_index: 0,
      image_url: item.image_urls[0],
      embedding: Array(3072).fill(0.1),
    },
  ],
});
const bucketKey = "scrape/28-paintings/vectors/100/10001.json";
const itemPath = () =>
  path.join(categoryItemsDir(category.segment), "100/10001.json");
const vectorPath = () =>
  path.join(categoryVectorsDir(category.segment), "100/10001.json");

beforeEach(async () => {
  vi.resetAllMocks();
  scratch.root = await mkdtemp(path.join(tmpdir(), "examen-cron-vectors-"));
  await mkdir(path.dirname(itemPath()), { recursive: true });
  await writeFile(itemPath(), JSON.stringify(item));
  vi.mocked(qdrantClient.retrieve).mockResolvedValue([{ id: 1000100 }]);
  vi.mocked(catalogObjectExists).mockResolvedValue(true);
  vi.mocked(downloadCatalogObject).mockImplementation(
    async (_key, destination) => {
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, artifact);
    },
  );
});

afterEach(async () => {
  await rm(scratch.root, { recursive: true, force: true });
});

it("restores bucket vectors on a fresh disk even when already indexed, so embed skips them", async () => {
  const prepared = await prepareVectors(category, false);
  expect(downloadCatalogObject).toHaveBeenCalledWith(bucketKey, vectorPath());
  expect(prepared).toEqual({ downloaded: 1, pendingEmbed: 0, unsold: 0 });
  expect(await readFile(vectorPath(), "utf8")).toBe(artifact);
  expect(qdrantClient.retrieve).not.toHaveBeenCalled();

  // Run the real embed CLI in dry-run mode: an absent artifact would report
  // embedded 1 instead of skipped 1. No OpenRouter request can be made.
  const { stdout } = await promisify(execFile)(process.execPath, [
    "--import",
    "tsx",
    "scripts/embed.ts",
    "--items",
    categoryItemsDir(category.segment),
    "--out",
    categoryVectorsDir(category.segment),
    "--dry-run",
  ]);
  expect(stdout).toContain(
    "Summary: embedded 0, skipped 1, unsold 0, failed 0, images 0",
  );
});

it("keeps an existing local artifact without contacting either service", async () => {
  await mkdir(path.dirname(vectorPath()), { recursive: true });
  await writeFile(vectorPath(), artifact);
  await expect(prepareVectors(category, false)).resolves.toEqual({
    downloaded: 0,
    pendingEmbed: 0,
    unsold: 0,
  });
  expect(catalogObjectExists).not.toHaveBeenCalled();
  expect(downloadCatalogObject).not.toHaveBeenCalled();
  expect(qdrantClient.retrieve).not.toHaveBeenCalled();
  expect(await readFile(vectorPath(), "utf8")).toBe(artifact);
});

it("leaves items without a durable artifact for embedding", async () => {
  vi.mocked(catalogObjectExists).mockResolvedValue(false);
  await expect(prepareVectors(category, false)).resolves.toEqual({
    downloaded: 0,
    pendingEmbed: 1,
    unsold: 0,
  });
  expect(catalogObjectExists).toHaveBeenCalledWith(bucketKey);
  expect(downloadCatalogObject).not.toHaveBeenCalled();
  await expect(readFile(vectorPath())).rejects.toMatchObject({
    code: "ENOENT",
  });
});

it("ignores unsold items", async () => {
  await writeFile(itemPath(), JSON.stringify({ ...item, status: "unsold" }));
  await expect(prepareVectors(category, false)).resolves.toEqual({
    downloaded: 0,
    pendingEmbed: 0,
    unsold: 1,
  });
  expect(catalogObjectExists).not.toHaveBeenCalled();
});

it("does not contact storage or Qdrant in dry-run mode", async () => {
  await expect(prepareVectors(category, true)).resolves.toEqual({
    downloaded: 0,
    pendingEmbed: 1,
    unsold: 0,
  });
  expect(catalogObjectExists).not.toHaveBeenCalled();
  expect(downloadCatalogObject).not.toHaveBeenCalled();
  expect(qdrantClient.retrieve).not.toHaveBeenCalled();
});

it("stops on a failed artifact download instead of proceeding to paid embedding", async () => {
  vi.mocked(downloadCatalogObject).mockRejectedValue(
    new Error("Bucket unavailable"),
  );
  await expect(prepareVectors(category, false)).rejects.toThrow(
    "Bucket unavailable",
  );
});
