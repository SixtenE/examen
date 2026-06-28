import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock } from "../../helpers/mock-db";

const QUERY_ID = "550e8400-e29b-41d4-a716-446655440000";
const params = Promise.resolve({ id: QUERY_ID });

describe("GET /api/queries/[id]/matches", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("@/lib/rate-limit", () => ({
      enforceRateLimit: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("@/lib/s3", () => ({ s3Client: {} }));
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
