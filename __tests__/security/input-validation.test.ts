import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createDbMock } from "../helpers/mock-db";

const QUERY_ID = "550e8400-e29b-41d4-a716-446655440000";
const OWNER_ID = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

function encodeCursor(payload: unknown) {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function makeListRequest(path: string) {
  return new NextRequest(new URL(path, "http://localhost:3000"), {
    headers: { cookie: `examen-owner=${OWNER_ID}` },
  });
}

function lastLimitArg(db: unknown) {
  const selectMock = vi.mocked(
    (db as { select: ReturnType<typeof vi.fn> }).select,
  );
  const chain = selectMock.mock.results.at(-1)?.value.from.mock.results.at(-1)
    ?.value;
  return chain?.limit.mock.calls.at(-1)?.[0] as number | undefined;
}

beforeEach(() => {
  vi.resetModules();
  vi.doMock("@/lib/rate-limit", () => ({
    enforceRateLimit: vi.fn().mockResolvedValue(null),
  }));
});

afterEach(() => {
  vi.clearAllMocks();
  vi.doUnmock("@/db");
  vi.doUnmock("@/lib/rate-limit");
});

describe("cursor tampering: GET /api/queries", () => {
  it.each([
    ["not-base64-at-all!!!", "not valid base64url JSON"],
    [Buffer.from("hello world").toString("base64url"), "base64 of non-JSON"],
    [Buffer.from("null").toString("base64url"), "base64 of null"],
    [
      encodeCursor({ createdAt: 12345, id: QUERY_ID }),
      "createdAt with the wrong type",
    ],
    [
      encodeCursor({ createdAt: { $gt: "" }, id: QUERY_ID }),
      "NoSQL-style operator object",
    ],
    [
      encodeCursor({ createdAt: "not-a-date", id: QUERY_ID }),
      "unparseable date",
    ],
    [
      encodeCursor({
        createdAt: "2026-01-01T00:00:00.000Z",
        id: "'; DROP TABLE queries;--",
      }),
      "SQL injection in the id field",
    ],
    [
      encodeCursor({ createdAt: "2026-01-01T00:00:00.000Z", id: "../../etc" }),
      "path traversal in the id field",
    ],
  ])("returns 400 for %s (%s)", async (cursor) => {
    vi.doMock("@/db", () => ({ db: createDbMock().db }));
    const { GET } = await import("@/app/api/queries/route");

    const response = await GET(
      makeListRequest(`/api/queries?cursor=${encodeURIComponent(cursor)}`),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: "Invalid cursor" });
  });

  it("does not pollute the prototype chain from a crafted cursor", async () => {
    vi.doMock("@/db", () => ({ db: createDbMock({ selectResults: [[]] }).db }));
    const { GET } = await import("@/app/api/queries/route");

    const cursor = encodeCursor({
      createdAt: "2026-01-01T00:00:00.000Z",
      id: QUERY_ID,
      __proto__: { isAdmin: true },
      constructor: { prototype: { isAdmin: true } },
    });

    const response = await GET(
      makeListRequest(`/api/queries?cursor=${encodeURIComponent(cursor)}`),
    );

    expect(response.status).toBe(200);
    expect(({} as Record<string, unknown>).isAdmin).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty("isAdmin");
  });
});

describe("limit abuse: GET /api/queries", () => {
  it.each([
    ["0", 2], // clamped up to 1 (+1 lookahead)
    ["-100", 2],
    ["999999", 51], // clamped down to 50 (+1 lookahead)
    ["abc", 13], // default 12 (+1 lookahead)
    ["", 13],
  ])("clamps limit=%j to a bounded database read", async (limit, expected) => {
    const mockDb = createDbMock({ selectResults: [[]] });
    vi.doMock("@/db", () => ({ db: mockDb.db }));
    const { GET } = await import("@/app/api/queries/route");

    const response = await GET(makeListRequest(`/api/queries?limit=${limit}`));

    expect(response.status).toBe(200);
    expect(lastLimitArg(mockDb.db)).toBe(expected);
  });
});

describe("route id injection: /api/queries/[id]", () => {
  const maliciousIds = [
    ["SQL injection", "' OR '1'='1' --"],
    ["SQL injection in uuid shape", "550e8400-e29b-41d4-a716-44665544000'"],
    ["path traversal", "../../etc/passwd"],
    ["encoded traversal", "%2e%2e%2f%2e%2e%2fetc"],
    ["XSS payload", "<script>alert(document.cookie)</script>"],
    ["null byte", "550e8400-e29b-41d4-a716-446655440000%00"],
    ["uuid with extra suffix", `${QUERY_ID}.json`],
  ] as const;

  it.each(maliciousIds)(
    "GET rejects %s without touching the database",
    async (_label, id) => {
      const mockDb = createDbMock();
      vi.doMock("@/db", () => ({ db: mockDb.db }));
      vi.doMock("@/lib/s3", () => ({ s3Client: { send: vi.fn() } }));
      vi.doMock("@aws-sdk/s3-request-presigner", () => ({
        getSignedUrl: vi.fn(),
      }));
      const { GET } = await import("@/app/api/queries/[id]/route");

      const response = await GET(
        makeListRequest(`/api/queries/${id}`),
        { params: Promise.resolve({ id: decodeURIComponent(id) }) },
      );
      const body = await response.json();

      expect(response.status).toBe(404);
      expect(body).toEqual({ error: "Query not found" });
      expect(mockDb.db.select).not.toHaveBeenCalled();
      expect(response.headers.get("content-type")).toContain(
        "application/json",
      );

      vi.doUnmock("@/lib/s3");
      vi.doUnmock("@aws-sdk/s3-request-presigner");
    },
  );

  it.each(maliciousIds)(
    "DELETE rejects %s before any destructive work",
    async (_label, id) => {
      const mockDb = createDbMock();
      vi.doMock("@/db", () => ({ db: mockDb.db }));
      const mockS3Send = vi.fn();
      vi.doMock("@/lib/s3", () => ({ s3Client: { send: mockS3Send } }));
      const { DELETE } = await import("@/app/api/queries/[id]/route");

      const response = await DELETE(
        makeListRequest(`/api/queries/${id}`),
        { params: Promise.resolve({ id: decodeURIComponent(id) }) },
      );

      expect(response.status).toBe(404);
      expect(mockDb.db.select).not.toHaveBeenCalled();
      expect(mockDb.db.transaction).not.toHaveBeenCalled();
      expect(mockS3Send).not.toHaveBeenCalled();

      vi.doUnmock("@/lib/s3");
    },
  );

  it("matches POST rejects SQL injection before any paid work", async () => {
    const mockDb = createDbMock();
    const mockEmbedImageUrl = vi.fn();
    vi.doMock("@/db", () => ({ db: mockDb.db }));
    vi.doMock("@/lib/s3", () => ({ s3Client: { send: vi.fn() } }));
    vi.doMock("@aws-sdk/s3-request-presigner", () => ({
      getSignedUrl: vi.fn(),
    }));
    vi.doMock("@/lib/embeddings", () => ({ embedImageUrl: mockEmbedImageUrl }));
    vi.doMock("@/lib/qdrant", () => ({
      qdrantClient: { query: vi.fn() },
    }));
    const { POST } = await import("@/app/api/queries/[id]/matches/route");

    const response = await POST(
      new NextRequest(
        `http://localhost:3000/api/queries/' OR '1'='1' --/matches`,
        { method: "POST", headers: { cookie: `examen-owner=${OWNER_ID}` } },
      ),
      { params: Promise.resolve({ id: "' OR '1'='1' --" }) },
    );

    expect(response.status).toBe(404);
    expect(mockDb.db.update).not.toHaveBeenCalled();
    expect(mockEmbedImageUrl).not.toHaveBeenCalled();

    vi.doUnmock("@/lib/s3");
    vi.doUnmock("@aws-sdk/s3-request-presigner");
    vi.doUnmock("@/lib/embeddings");
    vi.doUnmock("@/lib/qdrant");
  });
});

describe("error information leakage", () => {
  it("GET /api/queries/[id]/matches hides database errors behind a generic 500", async () => {
    vi.doMock("@/db", () => ({
      db: {
        select: vi.fn(() => {
          throw new Error(
            "connect ECONNREFUSED postgres://admin:hunter2@db.internal:5432",
          );
        }),
      },
    }));
    vi.doMock("@/lib/s3", () => ({ s3Client: { send: vi.fn() } }));
    vi.doMock("@aws-sdk/s3-request-presigner", () => ({
      getSignedUrl: vi.fn(),
    }));
    vi.doMock("@/lib/embeddings", () => ({ embedImageUrl: vi.fn() }));
    vi.doMock("@/lib/qdrant", () => ({
      qdrantClient: { query: vi.fn() },
    }));
    const { GET } = await import("@/app/api/queries/[id]/matches/route");

    const response = await GET(
      makeListRequest(`/api/queries/${QUERY_ID}/matches`),
      { params: Promise.resolve({ id: QUERY_ID }) },
    );
    const raw = await response.text();

    expect(response.status).toBe(500);
    expect(JSON.parse(raw)).toEqual({ error: "Internal server error" });
    expect(raw).not.toContain("hunter2");
    expect(raw).not.toContain("postgres://");
    expect(raw).not.toContain("ECONNREFUSED");

    vi.doUnmock("@/lib/s3");
    vi.doUnmock("@aws-sdk/s3-request-presigner");
    vi.doUnmock("@/lib/embeddings");
    vi.doUnmock("@/lib/qdrant");
  });

  it("GET /api/queries hides database errors behind a generic 500", async () => {
    vi.doMock("@/db", () => ({
      db: {
        select: vi.fn(() => {
          throw new Error("relation \"queries\" does not exist");
        }),
      },
    }));
    const { GET } = await import("@/app/api/queries/route");

    const response = await GET(makeListRequest("/api/queries"));
    const raw = await response.text();

    expect(response.status).toBe(500);
    expect(JSON.parse(raw)).toEqual({ error: "Internal server error" });
    expect(raw).not.toContain("queries");
  });
});
