import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createDbMock } from "../../helpers/mock-db";

const OWNER_ID = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

function makeRequest(url: string) {
  return new NextRequest(new URL(url, "http://localhost:3000"), {
    headers: { cookie: `examen-owner=${OWNER_ID}` },
  });
}

describe("GET /api/queries", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("@/lib/rate-limit", () => ({
      enforceRateLimit: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("@/db", () => {
      const mockDb = createDbMock({
        selectResults: [
          [
            {
              id: "550e8400-e29b-41d4-a716-446655440000",
              title: "Rare Vase",
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
    vi.doUnmock("@/lib/rate-limit");
  });

  it("returns paginated query items", async () => {
    const { GET } = await import("@/app/api/queries/route");
    const response = await GET(makeRequest("/api/queries"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].title).toBe("Rare Vase");
    expect(body.items[0].image_key).toBeUndefined();
    expect(body.nextCursor).toBeNull();
  });

  it("returns no queries without an owner cookie", async () => {
    const { GET } = await import("@/app/api/queries/route");
    const response = await GET(
      new NextRequest("http://localhost:3000/api/queries"),
    );

    await expect(response.json()).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
  });

  it("returns 400 for an invalid cursor", async () => {
    const { GET } = await import("@/app/api/queries/route");
    const response = await GET(
      makeRequest("/api/queries?cursor=not-valid-base64"),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Invalid cursor");
  });

  it.each([
    ["999", 51],
    ["0", 2],
    ["-1", 2],
    ["invalid", 13],
  ])(
    "bounds limit %s (including the lookahead row)",
    async (limit, expected) => {
      const { db } = await import("@/db");
      const { GET } = await import("@/app/api/queries/route");

      await GET(makeRequest(`/api/queries?limit=${limit}`));

      const chain = vi
        .mocked(db.select)
        .mock.results.at(-1)
        ?.value.from.mock.results.at(-1)?.value;
      expect(chain?.limit).toHaveBeenCalledWith(expected);
    },
  );

  it("returns a cursor for the last visible item, excluding the lookahead row", async () => {
    const rows = [
      {
        id: "550e8400-e29b-41d4-a716-446655440000",
        title: "First",
        createdAt: new Date("2026-06-11T10:00:00Z"),
      },
      {
        id: "550e8400-e29b-41d4-a716-446655440001",
        title: "Second",
        createdAt: new Date("2026-06-10T10:00:00Z"),
      },
    ];
    vi.doMock("@/db", () => ({
      db: createDbMock({ selectResults: [rows] }).db,
    }));
    const { GET } = await import("@/app/api/queries/route");

    const response = await GET(makeRequest("/api/queries?limit=1"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.items.map((item: { id: string }) => item.id)).toEqual([
      rows[0].id,
    ]);
    expect(
      JSON.parse(Buffer.from(body.nextCursor, "base64url").toString()),
    ).toEqual({
      id: rows[0].id,
      createdAt: rows[0].createdAt.toISOString(),
    });
  });

  it.each([
    null,
    {},
    { id: "not-a-uuid", createdAt: "2026-06-11T10:00:00Z" },
    { id: OWNER_ID, createdAt: "not-a-date" },
  ])(
    "rejects malformed cursor data %j without querying the database",
    async (cursor) => {
      const { db } = await import("@/db");
      const { GET } = await import("@/app/api/queries/route");
      const encoded = Buffer.from(JSON.stringify(cursor)).toString("base64url");

      expect(
        (await GET(makeRequest(`/api/queries?cursor=${encoded}`))).status,
      ).toBe(400);
      expect(db.select).not.toHaveBeenCalled();
    },
  );
});
