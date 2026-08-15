import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { REFERENCE_COLLECTIONS } from "@/lib/catalog-paths";
import { createDbMock } from "../../helpers/mock-db";

const QUERY_ID = "550e8400-e29b-41d4-a716-446655440000";
const OWNER_ID = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
const IMAGE_KEY = "V1StGXR8_Z5jdHi6B-myT";
const params = Promise.resolve({ id: QUERY_ID });

const mockGetSignedUrl = vi
  .fn()
  .mockResolvedValue("https://signed.example/image");
const mockEmbedImageUrl = vi.fn().mockResolvedValue([0.1, 0.2, 0.3]);
const mockSearch = vi.fn();

const NOW_UNIX = Math.floor(new Date("2026-07-24T12:00:00Z").getTime() / 1000);
const MONTH_AGO_UNIX = NOW_UNIX - 30 * 86_400;
const FIVE_YEARS_AGO_UNIX = NOW_UNIX - 5 * 365 * 86_400;

function makeRequest(method = "GET") {
  return new NextRequest(
    `http://localhost:3000/api/queries/${QUERY_ID}/matches`,
    {
      method,
      headers: { cookie: `examen-owner=${OWNER_ID}` },
    },
  );
}

function hit(
  auctionetId: string,
  score: number,
  soldAt: number | null = MONTH_AGO_UNIX,
  extra: Record<string, unknown> = {},
) {
  return {
    score,
    payload: {
      auctionet_id: auctionetId,
      image_index: 0,
      image_url: `https://images.auctionet.com/uploads/item_${auctionetId}_0.jpg`,
      title: auctionetId,
      price: 100,
      currency: "SEK",
      source_url: `https://www.auctionet.com/${auctionetId}`,
      sold_at: soldAt,
      ...extra,
    },
  };
}

describe("GET /api/queries/[id]/matches", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("@/lib/rate-limit", () => ({
      enforceRateLimit: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("@/lib/s3", () => ({ s3Client: {} }));
    vi.doMock("@/lib/qdrant", () => ({
      qdrantClient: { query: vi.fn() },
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
              image_key: IMAGE_KEY,
              status: "ready",
              createdAt: new Date("2026-06-11T10:00:00Z"),
            },
          ],
          [
            {
              id: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
              query_id: QUERY_ID,
              auctionet_id: "1001",
              image_url: "https://images.auctionet.com/uploads/item_1001_0.jpg",
              title: "Similar vase",
              price: 100,
              currency: "SEK",
              similarity_score: 0.92,
              sold_at: new Date("2021-07-24T12:00:00Z"),
              createdAt: new Date("2026-06-11T10:05:00Z"),
            },
            {
              id: "6ba7b811-9dad-11d1-80b4-00c04fd430c9",
              query_id: QUERY_ID,
              auctionet_id: "1001",
              image_url: "https://images.auctionet.com/uploads/item_1001_1.jpg",
              title: "Similar vase duplicate",
              price: 100,
              currency: "SEK",
              similarity_score: 0.85,
              sold_at: new Date("2021-07-24T12:00:00Z"),
              createdAt: new Date("2026-06-11T10:04:00Z"),
            },
            {
              id: "6ba7b812-9dad-11d1-80b4-00c04fd430ca",
              query_id: QUERY_ID,
              auctionet_id: "1002",
              image_url: "https://images.auctionet.com/uploads/item_1002_0.jpg",
              title: "Recent vase",
              price: 120,
              currency: "SEK",
              similarity_score: 0.85,
              sold_at: new Date("2026-06-24T12:00:00Z"),
              createdAt: new Date("2026-06-11T10:06:00Z"),
            },
            {
              id: "6ba7b813-9dad-11d1-80b4-00c04fd430cb",
              query_id: QUERY_ID,
              auctionet_id: "javascript:alert(1)",
              image_url: "javascript:alert(1)",
              title: "<script>alert(1)</script>",
              price: 1,
              currency: "SEK",
              similarity_score: 0.99,
              sold_at: new Date("2026-06-24T12:00:00Z"),
              createdAt: new Date("2026-06-11T10:07:00Z"),
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
    vi.useRealTimers();
  });

  it("deduplicates matches by auctionet_id and ranks by recency-weighted score", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-24T12:00:00Z"));

    const { GET } = await import("@/app/api/queries/[id]/matches/route");
    const response = await GET(makeRequest(), { params });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toHaveLength(2);
    expect(body[0].auctionet_id).toBe("1002");
    expect(body[0].similarity_score).toBe(0.85);
    expect(body[1].auctionet_id).toBe("1001");
    expect(body[1].similarity_score).toBe(0.92);
  });

  it("returns 404 for invalid UUIDs", async () => {
    const { GET } = await import("@/app/api/queries/[id]/matches/route");
    const response = await GET(makeRequest(), {
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
    const response = await GET(makeRequest(), { params });
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
          hit("2000", 0.95, MONTH_AGO_UNIX),
          hit("2000", 0.8, MONTH_AGO_UNIX),
          ...Array.from({ length: 20 }, (_, index) =>
            hit(String(index + 2), 0.94 - index * 0.01),
          ),
        ]);
      }

      if (collection === "references-9-ceramics-porcelain") {
        return Promise.resolve([
          hit("2000", 0.85, MONTH_AGO_UNIX),
          ...Array.from({ length: 25 }, (_, index) =>
            hit(String(index + 22), 0.74 - index * 0.01),
          ),
        ]);
      }

      if ((REFERENCE_COLLECTIONS as readonly string[]).includes(collection)) {
        return Promise.resolve([]);
      }

      return Promise.reject(new Error(`unexpected collection: ${collection}`));
    });

    vi.doMock("@/lib/rate-limit", () => ({
      enforceRateLimit: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("@aws-sdk/s3-request-presigner", () => ({
      getSignedUrl: (...args: unknown[]) => mockGetSignedUrl(...args),
    }));
    vi.doMock("@/lib/s3", () => ({ s3Client: {} }));
    vi.doMock("@/lib/embeddings", () => ({
      embedImageUrl: (...args: unknown[]) => mockEmbedImageUrl(...args),
    }));
    vi.doMock("@/lib/qdrant", () => ({
      qdrantClient: {
        query: async (...args: unknown[]) => ({
          points: await mockSearch(...args),
        }),
      },
    }));
    vi.doMock("@/db", () => {
      const mockDb = createDbMock({
        updateReturning: [
          {
            id: QUERY_ID,
            title: "Golden Clock",
            image_key: IMAGE_KEY,
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
    vi.useRealTimers();
  });

  it("searches all category collections, deduplicates globally, and keeps top 32", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-24T12:00:00Z"));

    const { POST } = await import("@/app/api/queries/[id]/matches/route");
    const response = await POST(makeRequest("POST"), { params });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockSearch).toHaveBeenCalledTimes(REFERENCE_COLLECTIONS.length);
    expect(mockSearch).toHaveBeenCalledWith(
      "references-28-paintings",
      expect.objectContaining({ limit: 128, with_payload: true }),
    );
    expect(mockSearch).toHaveBeenCalledWith(
      "references-9-ceramics-porcelain",
      expect.objectContaining({ limit: 128, with_payload: true }),
    );
    expect(body).toHaveLength(32);
    expect(body[0].auctionet_id).toBe("2000");
    expect(body[0].similarity_score).toBe(0.95);
    expect(
      body.some((row: { auctionet_id: string }) => row.auctionet_id === "46"),
    ).toBe(false);
  });

  it("ranks a recent mid score above an old high score", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-24T12:00:00Z"));

    mockSearch.mockImplementation((collection: string) => {
      if (collection === "references-28-paintings") {
        return Promise.resolve([
          hit("3000", 0.92, FIVE_YEARS_AGO_UNIX),
          hit("3001", 0.85, MONTH_AGO_UNIX),
        ]);
      }

      if ((REFERENCE_COLLECTIONS as readonly string[]).includes(collection)) {
        return Promise.resolve([]);
      }

      return Promise.reject(new Error(`unexpected collection: ${collection}`));
    });

    const { POST } = await import("@/app/api/queries/[id]/matches/route");
    const response = await POST(makeRequest("POST"), { params });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toHaveLength(2);
    expect(body[0].auctionet_id).toBe("3001");
    expect(body[0].similarity_score).toBe(0.85);
    expect(body[1].auctionet_id).toBe("3000");
    expect(body[1].similarity_score).toBe(0.92);
  });

  it("does not regenerate matches for a ready query", async () => {
    vi.doMock("@/db", () => {
      const mockDb = createDbMock({
        updateReturning: [],
        selectResults: [[{ id: QUERY_ID, status: "ready" }]],
      });
      return { db: mockDb.db };
    });

    const { POST } = await import("@/app/api/queries/[id]/matches/route");
    const response = await POST(makeRequest("POST"), { params });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ready" });
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it("does not expose upstream error details", async () => {
    mockEmbedImageUrl.mockRejectedValueOnce(
      new Error("secret upstream detail"),
    );

    const { POST } = await import("@/app/api/queries/[id]/matches/route");
    const response = await POST(makeRequest("POST"), { params });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Internal server error",
    });
  });

  it("drops Qdrant payloads that are not Auctionet catalog images", async () => {
    mockSearch.mockImplementation((collection: string) => {
      if (collection === "references-28-paintings") {
        return Promise.resolve([
          hit("4000", 0.9, MONTH_AGO_UNIX),
          hit("4001", 0.89, MONTH_AGO_UNIX, {
            image_url: "javascript:alert(1)",
          }),
          hit("https://evil.example/x", 0.88, MONTH_AGO_UNIX),
          hit("4002", 0.87, MONTH_AGO_UNIX, {
            image_url: "https://evil.example/pixel.jpg",
          }),
        ]);
      }

      if ((REFERENCE_COLLECTIONS as readonly string[]).includes(collection)) {
        return Promise.resolve([]);
      }

      return Promise.reject(new Error(`unexpected collection: ${collection}`));
    });

    const { POST } = await import("@/app/api/queries/[id]/matches/route");
    const response = await POST(makeRequest("POST"), { params });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual([
      expect.objectContaining({
        auctionet_id: "4000",
        image_url: "https://images.auctionet.com/uploads/item_4000_0.jpg",
      }),
    ]);
  });
});
