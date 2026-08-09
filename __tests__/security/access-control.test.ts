import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createDbMock } from "../helpers/mock-db";

const QUERY_ID = "550e8400-e29b-41d4-a716-446655440000";
const OWNER_ID = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
const ATTACKER_ID = "11111111-2222-4333-8444-555555555555";

const mockEnforceRateLimit = vi.fn().mockResolvedValue(null);
const mockGetSignedUrl = vi
  .fn()
  .mockResolvedValue("https://signed.example/image");
const mockS3Send = vi.fn().mockResolvedValue({});
const mockEmbedImageUrl = vi.fn().mockResolvedValue([0.1, 0.2, 0.3]);
const mockQdrantQuery = vi.fn().mockResolvedValue({ points: [] });

const queryRow = {
  id: QUERY_ID,
  title: "Golden Clock",
  image_key: "img-key",
  status: "ready" as const,
  createdAt: new Date("2026-06-11T10:00:00Z"),
};

function makeRequest(
  path: string,
  options: { method?: string; cookie?: string | null } = {},
) {
  const headers = new Headers();
  if (options.cookie !== undefined && options.cookie !== null) {
    headers.set("cookie", options.cookie);
  }
  return new NextRequest(`http://localhost:3000${path}`, {
    method: options.method ?? "GET",
    headers,
  });
}

function setupMocks(
  dbOptions: Parameters<typeof createDbMock>[0] = {},
  rateLimitResponse: Response | null = null,
) {
  mockEnforceRateLimit.mockResolvedValue(rateLimitResponse);
  vi.doMock("@/lib/rate-limit", () => ({
    enforceRateLimit: (...args: unknown[]) => mockEnforceRateLimit(...args),
  }));
  vi.doMock("@/lib/s3", () => ({ s3Client: { send: mockS3Send } }));
  vi.doMock("@aws-sdk/s3-request-presigner", () => ({
    getSignedUrl: (...args: unknown[]) => mockGetSignedUrl(...args),
  }));
  vi.doMock("@/lib/embeddings", () => ({
    embedImageUrl: (...args: unknown[]) => mockEmbedImageUrl(...args),
  }));
  vi.doMock("@/lib/qdrant", () => ({
    qdrantClient: { query: mockQdrantQuery },
  }));
  const mockDb = createDbMock(dbOptions);
  vi.doMock("@/db", () => ({ db: mockDb.db }));
  return mockDb;
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.clearAllMocks();
  vi.doUnmock("@/db");
  vi.doUnmock("@/lib/s3");
  vi.doUnmock("@/lib/qdrant");
  vi.doUnmock("@/lib/embeddings");
  vi.doUnmock("@/lib/rate-limit");
  vi.doUnmock("@aws-sdk/s3-request-presigner");
});

describe("IDOR: GET /api/queries/[id]", () => {
  const params = Promise.resolve({ id: QUERY_ID });

  it("returns 404 and signs no URL for a query owned by someone else", async () => {
    const mockDb = setupMocks({ selectResults: [[]] });
    const { GET } = await import("@/app/api/queries/[id]/route");

    const response = await GET(
      makeRequest(`/api/queries/${QUERY_ID}`, {
        cookie: `examen-owner=${ATTACKER_ID}`,
      }),
      { params },
    );

    expect(response.status).toBe(404);
    expect(mockGetSignedUrl).not.toHaveBeenCalled();
    expect(mockDb.db.select).toHaveBeenCalledTimes(1);
  });

  it("returns 404 without touching the database when the owner cookie is missing", async () => {
    const mockDb = setupMocks({ selectResults: [[queryRow]] });
    const { GET } = await import("@/app/api/queries/[id]/route");

    const response = await GET(makeRequest(`/api/queries/${QUERY_ID}`), {
      params,
    });

    expect(response.status).toBe(404);
    expect(mockDb.db.select).not.toHaveBeenCalled();
    expect(mockGetSignedUrl).not.toHaveBeenCalled();
  });

  it("treats a malformed owner cookie as unauthenticated", async () => {
    const mockDb = setupMocks({ selectResults: [[queryRow]] });
    const { GET } = await import("@/app/api/queries/[id]/route");

    const response = await GET(
      makeRequest(`/api/queries/${QUERY_ID}`, {
        cookie: "examen-owner=not-a-uuid",
      }),
      { params },
    );

    expect(response.status).toBe(404);
    expect(mockDb.db.select).not.toHaveBeenCalled();
  });

  it("issues only a short-lived signed URL to the owner", async () => {
    setupMocks({ selectResults: [[queryRow]] });
    const { GET } = await import("@/app/api/queries/[id]/route");

    const response = await GET(
      makeRequest(`/api/queries/${QUERY_ID}`, {
        cookie: `examen-owner=${OWNER_ID}`,
      }),
      { params },
    );

    expect(response.status).toBe(200);
    // The signed URL must be short-lived.
    expect(mockGetSignedUrl).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ expiresIn: 3600 }),
    );
  });
});

describe("IDOR: DELETE /api/queries/[id]", () => {
  const params = Promise.resolve({ id: QUERY_ID });

  it("deletes nothing when the owner cookie is missing", async () => {
    const mockDb = setupMocks({ selectResults: [[queryRow]] });
    const { DELETE } = await import("@/app/api/queries/[id]/route");

    const response = await DELETE(
      makeRequest(`/api/queries/${QUERY_ID}`, { method: "DELETE" }),
      { params },
    );

    expect(response.status).toBe(404);
    expect(mockDb.db.transaction).not.toHaveBeenCalled();
    expect(mockS3Send).not.toHaveBeenCalled();
  });

  it("deletes nothing for a query owned by someone else", async () => {
    const mockDb = setupMocks({ selectResults: [[]] });
    const { DELETE } = await import("@/app/api/queries/[id]/route");

    const response = await DELETE(
      makeRequest(`/api/queries/${QUERY_ID}`, {
        method: "DELETE",
        cookie: `examen-owner=${ATTACKER_ID}`,
      }),
      { params },
    );

    expect(response.status).toBe(404);
    expect(mockDb.db.transaction).not.toHaveBeenCalled();
    expect(mockS3Send).not.toHaveBeenCalled();
  });
});

describe("cost & access control: POST /api/queries/[id]/matches", () => {
  const params = Promise.resolve({ id: QUERY_ID });

  it("rejects unauthenticated callers before any paid work", async () => {
    const mockDb = setupMocks();
    const { POST } = await import("@/app/api/queries/[id]/matches/route");

    const response = await POST(
      makeRequest(`/api/queries/${QUERY_ID}/matches`, { method: "POST" }),
      { params },
    );

    expect(response.status).toBe(404);
    expect(mockDb.db.update).not.toHaveBeenCalled();
    expect(mockEmbedImageUrl).not.toHaveBeenCalled();
    expect(mockQdrantQuery).not.toHaveBeenCalled();
  });

  it("does not spend embedding API calls on someone else's query", async () => {
    setupMocks({ updateReturning: [], selectResults: [[]] });
    const { POST } = await import("@/app/api/queries/[id]/matches/route");

    const response = await POST(
      makeRequest(`/api/queries/${QUERY_ID}/matches`, {
        method: "POST",
        cookie: `examen-owner=${ATTACKER_ID}`,
      }),
      { params },
    );

    expect(response.status).toBe(404);
    expect(mockEmbedImageUrl).not.toHaveBeenCalled();
    expect(mockQdrantQuery).not.toHaveBeenCalled();
    expect(mockGetSignedUrl).not.toHaveBeenCalled();
  });

  it("does not regenerate matches for a ready query (replay protection)", async () => {
    setupMocks({
      updateReturning: [],
      selectResults: [[{ id: QUERY_ID, status: "ready" }]],
    });
    const { POST } = await import("@/app/api/queries/[id]/matches/route");

    const response = await POST(
      makeRequest(`/api/queries/${QUERY_ID}/matches`, {
        method: "POST",
        cookie: `examen-owner=${OWNER_ID}`,
      }),
      { params },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ready" });
    expect(mockEmbedImageUrl).not.toHaveBeenCalled();
    expect(mockQdrantQuery).not.toHaveBeenCalled();
  });

  it("only ever embeds a server-generated signed URL for the stored image key", async () => {
    setupMocks({
      updateReturning: [{ ...queryRow, status: "processing" }],
      transactionImpl: async (callback) => {
        const tx = {
          delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
          insert: vi.fn(() => ({
            values: vi.fn(() => ({ returning: vi.fn().mockResolvedValue([]) })),
          })),
        };
        return callback(tx);
      },
    });
    const { POST } = await import("@/app/api/queries/[id]/matches/route");

    const response = await POST(
      makeRequest(`/api/queries/${QUERY_ID}/matches`, {
        method: "POST",
        cookie: `examen-owner=${OWNER_ID}`,
      }),
      { params },
    );

    expect(response.status).toBe(200);
    // The embed target comes from the stored image_key via a short-lived
    // signed URL — never from request input (no SSRF surface).
    expect(mockGetSignedUrl).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        input: expect.objectContaining({ Key: "img-key" }),
      }),
      expect.objectContaining({ expiresIn: 300 }),
    );
    expect(mockEmbedImageUrl).toHaveBeenCalledTimes(1);
    expect(mockEmbedImageUrl).toHaveBeenCalledWith(
      "https://signed.example/image",
    );
  });
});

describe("IDOR: GET /api/queries/[id]/matches", () => {
  const params = Promise.resolve({ id: QUERY_ID });

  it("returns 404 without the owner cookie", async () => {
    const mockDb = setupMocks();
    const { GET } = await import("@/app/api/queries/[id]/matches/route");

    const response = await GET(
      makeRequest(`/api/queries/${QUERY_ID}/matches`),
      { params },
    );

    expect(response.status).toBe(404);
    expect(mockDb.db.select).not.toHaveBeenCalled();
  });

  it("returns 404 for a query owned by someone else", async () => {
    setupMocks({ selectResults: [[]] });
    const { GET } = await import("@/app/api/queries/[id]/matches/route");

    const response = await GET(
      makeRequest(`/api/queries/${QUERY_ID}/matches`, {
        cookie: `examen-owner=${ATTACKER_ID}`,
      }),
      { params },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Query not found",
    });
  });
});

describe("listing isolation: GET /api/queries", () => {
  it("returns an empty list instead of other users' queries without a cookie", async () => {
    const mockDb = setupMocks({ selectResults: [[queryRow]] });
    const { GET } = await import("@/app/api/queries/route");

    const response = await GET(makeRequest("/api/queries"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
    expect(mockDb.db.select).not.toHaveBeenCalled();
  });
});

describe("rate-limit enforcement on mutations", () => {
  const params = Promise.resolve({ id: QUERY_ID });
  const tooManyRequests = () =>
    Response.json({ error: "Too many requests" }, { status: 429 });

  it("blocks DELETE before any database or storage work", async () => {
    const mockDb = setupMocks({}, tooManyRequests());
    const { DELETE } = await import("@/app/api/queries/[id]/route");

    const response = await DELETE(
      makeRequest(`/api/queries/${QUERY_ID}`, {
        method: "DELETE",
        cookie: `examen-owner=${OWNER_ID}`,
      }),
      { params },
    );

    expect(response.status).toBe(429);
    expect(mockEnforceRateLimit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        scope: "api:queries:id:delete",
        failClosed: true,
      }),
    );
    expect(mockDb.db.select).not.toHaveBeenCalled();
    expect(mockS3Send).not.toHaveBeenCalled();
  });

  it("blocks match generation before any paid work", async () => {
    const mockDb = setupMocks({}, tooManyRequests());
    const { POST } = await import("@/app/api/queries/[id]/matches/route");

    const response = await POST(
      makeRequest(`/api/queries/${QUERY_ID}/matches`, {
        method: "POST",
        cookie: `examen-owner=${OWNER_ID}`,
      }),
      { params },
    );

    expect(response.status).toBe(429);
    expect(mockEnforceRateLimit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        scope: "api:queries:id:matches:post",
        failClosed: true,
      }),
    );
    expect(mockDb.db.update).not.toHaveBeenCalled();
    expect(mockEmbedImageUrl).not.toHaveBeenCalled();
  });
});
