import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock } from "../../helpers/mock-db";

const QUERY_ID = "550e8400-e29b-41d4-a716-446655440000";
const params = Promise.resolve({ id: QUERY_ID });

const mockGetSignedUrl = vi.fn().mockResolvedValue("https://signed.example/image");
const mockEmbedImageUrl = vi.fn().mockResolvedValue([0.1, 0.2, 0.3]);
const mockSearch = vi.fn();

function hit(auctionetId: string, score: number) {
  return {
    score,
    payload: {
      auctionet_id: auctionetId,
      image_index: 0,
      image_url: `https://example.com/${auctionetId}.jpg`,
      title: auctionetId,
      price: 100,
      currency: "SEK",
      source_url: `https://www.auctionet.com/${auctionetId}`,
    },
  };
}

describe("GET /api/queries/[id]/matches", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("@/lib/rate-limit", () => ({
      enforceRateLimit: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("@/lib/s3", () => ({
      s3Client: {},
      requireAwsBucketName: () => "test-bucket",
    }));
    vi.doMock("@/lib/qdrant", () => ({
      qdrantClient: { search: vi.fn() },
    }));
    vi.doMock("@/lib/embeddings", () => ({
      embedImageUrl: vi.fn(),
    }));
    vi.doMock("@/db", () => {
      const mockDb = createDbMock({
        selectResults: [
          [
            {
              id: QUERY_ID,
              title: "Golden Clock",
              image_key: "img-key",
              status: "ready",
              createdAt: new Date("2026-06-11T10:00:00Z"),
            },
          ],
          [
            {
              id: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
              query_id: QUERY_ID,
              auctionet_id: "lot-1",
              image_url: "https://example.com/a.jpg",
              title: "Similar vase",
              price: 100,
              currency: "SEK",
              similarity_score: 0.92,
              createdAt: new Date("2026-06-11T10:05:00Z"),
            },
            {
              id: "6ba7b811-9dad-11d1-80b4-00c04fd430c9",
              query_id: QUERY_ID,
              auctionet_id: "lot-1",
              image_url: "https://example.com/b.jpg",
              title: "Similar vase duplicate",
              price: 100,
              currency: "SEK",
              similarity_score: 0.85,
              createdAt: new Date("2026-06-11T10:04:00Z"),
            },
          ],
        ],
      });
      return { db: mockDb.db };
    });
  });

  afterEach(() => {
    vi.doUnmock("@/db");
    vi.doUnmock("@/lib/s3");
    vi.doUnmock("@/lib/qdrant");
    vi.doUnmock("@/lib/embeddings");
    vi.doUnmock("@/lib/rate-limit");
  });

  it("deduplicates matches by auctionet_id", async () => {
    const { GET } = await import("@/app/api/queries/[id]/matches/route");
    const response = await GET({} as Request, { params });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0].auctionet_id).toBe("lot-1");
    expect(body[0].similarity_score).toBe(0.92);
  });

  it("returns 404 for invalid UUIDs", async () => {
    const { GET } = await import("@/app/api/queries/[id]/matches/route");
    const response = await GET({} as Request, {
      params: Promise.resolve({ id: "invalid" }),
    });

    expect(response.status).toBe(404);
  });

  it("returns 404 when the query does not exist", async () => {
    vi.doMock("@/db", () => {
      const mockDb = createDbMock({ selectResults: [[]] });
      return { db: mockDb.db };
    });

    const { GET } = await import("@/app/api/queries/[id]/matches/route");
    const response = await GET({} as Request, { params });
    expect(response.status).toBe(404);
  });
});

describe("POST /api/queries/[id]/matches", () => {
  beforeEach(() => {
    vi.resetModules();
    mockSearch.mockReset();
    mockSearch.mockImplementation((collection: string) => {
      if (collection === "references-28-paintings") {
        return Promise.resolve([
          hit("shared-item", 0.95),
          hit("shared-item", 0.8),
          ...Array.from({ length: 20 }, (_, index) =>
            hit(`item-${String(index + 2).padStart(3, "0")}`, 0.94 - index * 0.01),
          ),
        ]);
      }

      if (collection === "references-9-ceramics-porcelain") {
        return Promise.resolve([
          hit("shared-item", 0.85),
          ...Array.from({ length: 25 }, (_, index) =>
            hit(`item-${String(index + 22).padStart(3, "0")}`, 0.74 - index * 0.01),
          ),
        ]);
      }

      return Promise.reject(new Error(`unexpected collection: ${collection}`));
    });

    vi.doMock("@/lib/rate-limit", () => ({
      enforceRateLimit: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("@aws-sdk/s3-request-presigner", () => ({
      getSignedUrl: (...args: unknown[]) => mockGetSignedUrl(...args),
    }));
    vi.doMock("@/lib/s3", () => ({
      s3Client: {},
      requireAwsBucketName: () => "test-bucket",
    }));
    vi.doMock("@/lib/embeddings", () => ({
      embedImageUrl: (...args: unknown[]) => mockEmbedImageUrl(...args),
    }));
    vi.doMock("@/lib/qdrant", () => ({
      qdrantClient: { search: (...args: unknown[]) => mockSearch(...args) },
    }));
    vi.doMock("@/db", () => {
      const mockDb = createDbMock({
        updateReturning: [
          {
            id: QUERY_ID,
            title: "Golden Clock",
            image_key: "img-key",
            status: "processing",
            createdAt: new Date("2026-06-11T10:00:00Z"),
          },
        ],
        transactionImpl: async (callback) => {
          const tx = {
            delete: vi.fn(() => ({
              where: vi.fn().mockResolvedValue(undefined),
            })),
            insert: vi.fn(() => ({
              values: vi.fn((rows: unknown[]) => ({
                returning: vi.fn().mockResolvedValue(rows),
              })),
            })),
          };
          return callback(tx);
        },
      });
      return { db: mockDb.db };
    });
  });

  afterEach(() => {
    vi.doUnmock("@/db");
    vi.doUnmock("@/lib/s3");
    vi.doUnmock("@/lib/qdrant");
    vi.doUnmock("@/lib/embeddings");
    vi.doUnmock("@/lib/rate-limit");
    vi.doUnmock("@aws-sdk/s3-request-presigner");
  });

  it("searches all category collections, deduplicates globally, and keeps top 32", async () => {
    const { POST } = await import("@/app/api/queries/[id]/matches/route");
    const response = await POST({} as Request, { params });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockSearch).toHaveBeenCalledTimes(2);
    expect(mockSearch).toHaveBeenCalledWith(
      "references-28-paintings",
      expect.objectContaining({ limit: 128, with_payload: true }),
    );
    expect(mockSearch).toHaveBeenCalledWith(
      "references-9-ceramics-porcelain",
      expect.objectContaining({ limit: 128, with_payload: true }),
    );
    expect(body).toHaveLength(32);
    expect(body[0].auctionet_id).toBe("shared-item");
    expect(body[0].similarity_score).toBe(0.95);
    expect(body[1].auctionet_id).toBe("item-002");
    expect(body[31].auctionet_id).toBe("item-032");
    expect(body.some((row: { auctionet_id: string }) => row.auctionet_id === "item-046")).toBe(
      false,
    );
  });
});
