import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createDbMock } from "../../helpers/mock-db";

const QUERY_ID = "550e8400-e29b-41d4-a716-446655440000";
const OWNER_ID = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
const params = Promise.resolve({ id: QUERY_ID });

const mockGetSignedUrl = vi
  .fn()
  .mockResolvedValue("https://signed.example/image");
const mockS3Send = vi.fn().mockResolvedValue({});

function makeRequest(method = "GET") {
  return new NextRequest(`http://localhost:3000/api/queries/${QUERY_ID}`, {
    method,
    headers: { cookie: `examen-owner=${OWNER_ID}` },
  });
}

describe("GET /api/queries/[id]", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("@/lib/rate-limit", () => ({
      enforceRateLimit: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("@aws-sdk/s3-request-presigner", () => ({
      getSignedUrl: (...args: unknown[]) => mockGetSignedUrl(...args),
    }));
    vi.doMock("@/lib/s3", () => ({ s3Client: { send: mockS3Send } }));
    vi.doMock("@/db", () => {
      const mockDb = createDbMock({
        selectResults: [
          [
            {
              id: QUERY_ID,
              title: "Golden Clock",
              image_key: "V1StGXR8_Z5jdHi6B-myT",
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
    const response = await GET(makeRequest(), { params });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.id).toBe(QUERY_ID);
    expect(body.image_url).toBe("https://signed.example/image");
    expect(body.image_key).toBeUndefined();
    expect(mockGetSignedUrl).toHaveBeenCalled();
  });

  it("returns 404 for invalid UUIDs", async () => {
    const { GET } = await import("@/app/api/queries/[id]/route");
    const response = await GET(makeRequest(), {
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
    const response = await GET(makeRequest(), { params });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe("Query not found");
  });

  it("returns 404 without the owner cookie", async () => {
    const { GET } = await import("@/app/api/queries/[id]/route");
    const response = await GET(
      new NextRequest(`http://localhost:3000/api/queries/${QUERY_ID}`),
      { params },
    );

    expect(response.status).toBe(404);
  });

  it("does not sign catalog object keys", async () => {
    vi.doMock("@/db", () => {
      const mockDb = createDbMock({
        selectResults: [
          [
            {
              id: QUERY_ID,
              title: "Golden Clock",
              image_key: "scrape/9-ceramics-porcelain/123/123.json",
              status: "ready",
              createdAt: new Date("2026-06-11T10:00:00Z"),
            },
          ],
        ],
      });
      return { db: mockDb.db };
    });

    const { GET } = await import("@/app/api/queries/[id]/route");
    const response = await GET(makeRequest(), { params });

    expect(response.status).toBe(500);
    expect(mockGetSignedUrl).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/queries/[id]", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("@/lib/rate-limit", () => ({
      enforceRateLimit: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("@/lib/s3", () => ({ s3Client: { send: mockS3Send } }));
    vi.doMock("@/db", () => {
      const mockDb = createDbMock({
        selectResults: [
          [
            {
              id: QUERY_ID,
              title: "Golden Clock",
              image_key: "V1StGXR8_Z5jdHi6B-myT",
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
  });

  it("deletes matches and the query in a transaction", async () => {
    const { db } = await import("@/db");
    const { DELETE } = await import("@/app/api/queries/[id]/route");
    const response = await DELETE(makeRequest("DELETE"), { params });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message).toBe("Query deleted");
    expect(db.transaction).toHaveBeenCalled();
    expect(mockS3Send).toHaveBeenCalled();
  });

  it("returns 404 for invalid UUIDs", async () => {
    const { DELETE } = await import("@/app/api/queries/[id]/route");
    const response = await DELETE(makeRequest("DELETE"), {
      params: Promise.resolve({ id: "bad-id" }),
    });

    expect(response.status).toBe(404);
  });

  it("does not delete catalog objects from a tainted image key", async () => {
    vi.doMock("@/db", () => {
      const mockDb = createDbMock({
        selectResults: [
          [
            {
              id: QUERY_ID,
              title: "Golden Clock",
              image_key: "scrape/9-ceramics-porcelain/123/123.json",
              status: "ready",
              createdAt: new Date("2026-06-11T10:00:00Z"),
            },
          ],
        ],
      });
      return { db: mockDb.db };
    });

    const { DELETE } = await import("@/app/api/queries/[id]/route");
    const response = await DELETE(makeRequest("DELETE"), { params });

    expect(response.status).toBe(500);
    expect(mockS3Send).not.toHaveBeenCalled();
  });
});
