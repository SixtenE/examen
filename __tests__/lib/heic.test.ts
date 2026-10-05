// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { convertHeicToJpeg } from "@/lib/heic";

const converter = vi.hoisted(() => ({ path: undefined as string | undefined }));
vi.mock("node:module", async (original) => {
  const actual = await original<typeof import("node:module")>();
  return {
    ...actual,
    createRequire: (url: string | URL) => {
      const require = actual.createRequire(url);
      const resolve = require.resolve.bind(require);
      require.resolve = ((id: string) =>
        converter.path ?? resolve(id)) as NodeJS.RequireResolve;
      return require;
    },
  };
});

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "heic-worker-"));
});
afterEach(async () => {
  converter.path = undefined;
  vi.restoreAllMocks();
  await rm(directory, { recursive: true, force: true });
});

it("passes the original bytes and conversion options to a real worker", async () => {
  converter.path = path.join(directory, "converter.cjs");
  await writeFile(
    converter.path,
    `module.exports = async ({ buffer, format, quality }) => {
    if (!Buffer.isBuffer(buffer) || format !== "JPEG" || quality !== 0.9) throw new Error("Bad input");
    return buffer;
  };`,
  );
  const bytes = Buffer.from([0, 127, 255]);
  expect(await convertHeicToJpeg(bytes)).toEqual(bytes);
});

it("terminates CPU-bound conversion at the deadline instead of blocking the request", async () => {
  converter.path = path.join(directory, "converter.cjs");
  const marker = path.join(directory, "started");
  await writeFile(
    converter.path,
    `module.exports = async () => {
    require("node:fs").writeFileSync(${JSON.stringify(marker)}, "started");
    for (;;) {}
  };`,
  );
  const terminate = vi.spyOn(Worker.prototype, "terminate");
  await expect(convertHeicToJpeg(Buffer.from("heic"), 1000)).rejects.toThrow(
    "timed out",
  );
  expect(await readFile(marker, "utf8")).toBe("started");
  expect((terminate.mock.contexts[0] as Worker).threadId).toBe(-1);
});

it("rejects corrupt input through the installed HEIC decoder", async () => {
  await expect(convertHeicToJpeg(Buffer.from("not heic"))).rejects.toThrow(
    "not a HEIC image",
  );
});
