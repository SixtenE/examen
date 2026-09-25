// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { embedItem } from "../../scripts/embed";

const retrieve = vi.hoisted(() => vi.fn());
vi.mock("@/lib/qdrant", () => ({ qdrantClient: { retrieve } }));
const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
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
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
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
