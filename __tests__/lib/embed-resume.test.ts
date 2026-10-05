// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { embedItem, embedAuctionetVectors } from "../../scripts/embed";

const retrieve = vi.hoisted(() => vi.fn());
vi.mock("@/lib/qdrant", () => ({ qdrantClient: { retrieve } }));
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
    vi.stubEnv("OPENROUTER_API_KEY", "test");
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

it("shares the cron embedding budget across categories", async () => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const root = await mkdtemp(path.join(tmpdir(), "cron-budget-"));
  directories.push(root);
  const categories = ["28-paintings", "9-ceramics-porcelain", "1-furniture"];
  for (const category of categories) {
    const dir = path.join(root, "data/auctionet/items", category);
    await mkdir(dir, { recursive: true });
    for (let id = 100; id < 160; id++) {
      await writeFile(
        path.join(dir, `${id}.json`),
        JSON.stringify({
          auctionet_id: id,
          status: "sold",
          image_urls: Array.from(
            { length: 5 },
            (_, i) => `https://example.com/${id}/${i}.jpg`,
          ),
        }),
      );
    }
  }
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      "--import",
      path.resolve("node_modules/tsx/dist/loader.mjs"),
      path.resolve("scripts/cron.ts"),
      "--dry-run",
      "--stages",
      "embed",
      "--max-embed-items",
      "100",
      ...categories.flatMap((category) => ["--category", category]),
    ],
    {
      cwd: root,
      env: { ...process.env, TSX_TSCONFIG_PATH: path.resolve("tsconfig.json") },
    },
  );
  expect(stdout.match(/Embed summary: .*/g)).toEqual([
    "Embed summary: 60 items, 300 images, 0 skipped, 0 failed",
    "Embed summary: 40 items, 200 images, 0 skipped, 0 failed",
  ]);
  expect(stdout.match(/pending embed \d+/g)).toEqual([
    "pending embed 60",
    "pending embed 40",
  ]);
  expect(stdout).not.toContain("=== 1-furniture ===");
});
