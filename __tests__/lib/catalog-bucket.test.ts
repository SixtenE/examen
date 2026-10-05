// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { listCatalogKeyPages, readCatalogJson } from "@/lib/catalog-bucket";
import {
  clearCatalogFailure,
  listFailedCatalogItems,
  recordCatalogFailure,
} from "@/lib/catalog-failures";

const send = vi.hoisted(() => vi.fn());
vi.mock("@/lib/s3", () => ({ s3Client: { send } }));
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});

it("reads catalog JSON in memory and lazily paginates bucket listings", async () => {
  vi.stubEnv("AWS_BUCKET_NAME", "test-bucket");
  const prefix = "scrape/28-paintings";
  const key = `${prefix}/100/10001.json`;
  send.mockImplementation(async (command) => {
    if (command instanceof GetObjectCommand) {
      expect(command.input).toEqual({ Bucket: "test-bucket", Key: key });
      return {
        Body: {
          transformToByteArray: async () =>
            Buffer.from('{"auctionet_id":10001}'),
        },
      };
    }
    expect(command).toBeInstanceOf(ListObjectsV2Command);
    expect(command.input.Prefix).toBe(`${prefix}/`);
    return command.input.ContinuationToken
      ? { Contents: [{ Key: `${prefix}/100/10002.json` }], IsTruncated: false }
      : {
          Contents: [{ Key: key }, { Key: `${prefix}/` }],
          IsTruncated: true,
          NextContinuationToken: "page-2",
        };
  });
  const log = vi.fn();
  for await (const page of listCatalogKeyPages(prefix, log)) {
    expect(page).toEqual([key]);
    break;
  }
  expect(send).toHaveBeenCalledTimes(1);
  const pages: string[][] = [];
  for await (const page of listCatalogKeyPages(prefix, log)) pages.push(page);
  expect(pages).toEqual([[key], [`${prefix}/100/10002.json`]]);
  expect(send).toHaveBeenCalledTimes(3);
  expect(log).toHaveBeenCalledWith(expect.stringContaining("Listed page 2"));
  expect(await readCatalogJson(key)).toEqual({ auctionet_id: 10001 });
});

it("propagates invalid JSON or failed bucket reads instead of returning an empty object", async () => {
  vi.stubEnv("AWS_BUCKET_NAME", "test-bucket");
  send.mockResolvedValueOnce({
    Body: { transformToByteArray: async () => Buffer.from("invalid") },
  });
  await expect(
    readCatalogJson("scrape/28-paintings/100/10001.json"),
  ).rejects.toThrow();
  send.mockRejectedValueOnce(new Error("Access denied"));
  await expect(
    readCatalogJson("scrape/28-paintings/100/10001.json"),
  ).rejects.toThrow("Access denied");
});

it("writes the latest failure directly to its bucket key and deletes it on success", async () => {
  vi.stubEnv("AWS_BUCKET_NAME", "test-bucket");
  const itemKey = "scrape/28-paintings/100/10001.json";
  const failureKey = "scrape/28-paintings/failures/100/10001.json";
  send.mockResolvedValue({});
  await recordCatalogFailure(itemKey, new Error("First failure"));
  await recordCatalogFailure(itemKey, new Error("Retry failure"));
  await clearCatalogFailure(itemKey);
  const [first, retry, clear] = send.mock.calls.map(([command]) => command);
  for (const command of [first, retry]) {
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toMatchObject({
      Bucket: "test-bucket",
      Key: failureKey,
      ContentType: "application/json",
    });
  }
  expect(JSON.parse(retry.input.Body)).toEqual({
    item_key: itemKey,
    error: "Retry failure",
    failed_at: expect.any(String),
  });
  expect(clear).toBeInstanceOf(DeleteObjectCommand);
  expect(clear.input).toEqual({ Bucket: "test-bucket", Key: failureKey });
  send.mockRejectedValueOnce(new Error("Access denied"));
  await expect(clearCatalogFailure(itemKey)).rejects.toThrow("Access denied");
  send.mockRejectedValueOnce(new Error("Bucket unavailable"));
  await expect(
    recordCatalogFailure(itemKey, new Error("Embedding unavailable")),
  ).rejects.toThrow("Embedding unavailable): Bucket unavailable");
});

it("uses only failure objects from the requested category as the retry list", async () => {
  vi.stubEnv("AWS_BUCKET_NAME", "test-bucket");
  const prefix = "scrape/28-paintings/failures";
  send.mockResolvedValue({
    Contents: [
      { Key: `${prefix}/100/10001.json` },
      { Key: `${prefix}/` },
      { Key: `${prefix}/notes.json` },
      { Key: `${prefix}/../../outside.json` },
      { Key: "scrape/6-glass/failures/100/10002.json" },
    ],
  });
  expect(await listFailedCatalogItems("28-paintings")).toEqual(
    new Set(["scrape/28-paintings/100/10001.json"]),
  );
  expect(send.mock.calls[0][0].input.Prefix).toBe(`${prefix}/`);
});
