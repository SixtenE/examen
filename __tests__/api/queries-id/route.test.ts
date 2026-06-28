import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDbMock } from "../../helpers/mock-db";

const QUERY_ID = "550e8400-e29b-41d4-a716-446655440000";
const params = Promise.resolve({ id: QUERY_ID });

const mockGetSignedUrl = vi.fn().mockResolvedValue("https://signed.example/image");

describe("GET /api/queries/[id]", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("@/lib/rate-limit", () => ({
      enforceRateLimit: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("@aws-sdk/s3-request-presigner", () => ({
      getSignedUrl: (...args: unknown[]) => mockGetSignedUrl(...args),
    }));
    vi.doMock("@/lib/s3", () => ({ s3Client: {} }));
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
        ],
      });
      return { db: mockDb.db };
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.doUnmock("@/db");
    vi.doUnmock("@/lib/s3");
    vi.doUnmock("@/lib/rate-limit");
    vi.doUnmock("@aws-sdk/s3-request-presigner");
  });

  it("returns query detail with a signed image URL", async () => {
    const { GET } = await import("@/app/api/queries/[id]/route");
    const response = await GET({} as Request, { params });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.id).toBe(QUERY_ID);
    expect(body.image_url).toBe("https://signed.example/image");
    expect(mockGetSignedUrl).toHaveBeenCalled();
  });

  it("returns 404 for invalid UUIDs", async () => {
    const { GET } = await import("@/app/api/queries/[id]/route");
    const response = await GET({} as Request, {
      params: Promise.resolve({ id: "not-a-uuid" }),
    });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe("Query not found");
  });

  it("returns 404 when the query does not exist", async () => {
    vi.doMock("@/db", () => {
      const mockDb = createDbMock({ selectResults: [[]] });
      return { db: mockDb.db };
    });

    const { GET } = await import("@/app/api/queries/[id]/route");
    const response = await GET({} as Request, { params });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe("Query not found");
  });
});

describe("DELETE /api/queries/[id]", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("@/lib/rate-limit", () => ({
      enforceRateLimit: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("@/lib/s3", () => ({ s3Client: {} }));
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
        ],
      });
      return { db: mockDb.db };
    });
  });

  afterEach(() => {
    vi.doUnmock("@/db");
    vi.doUnmock("@/lib/s3");
    vi.doUnmock("@/lib/rate-limit");
  });

  it("deletes matches and the query in a transaction", async () => {
    const { db } = await import("@/db");
    const { DELETE } = await import("@/app/api/queries/[id]/route");
    const response = await DELETE({} as Request, { params });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message).toBe("Query deleted");
    expect(db.transaction).toHaveBeenCalled();
  });

  it("returns 404 for invalid UUIDs", async () => {
    const { DELETE } = await import("@/app/api/queries/[id]/route");
    const response = await DELETE({} as Request, {
      params: Promise.resolve({ id: "bad-id" }),
    });

    expect(response.status).toBe(404);
  });
});
