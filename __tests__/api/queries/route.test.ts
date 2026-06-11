import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createDbMock } from "../../helpers/mock-db";

function makeRequest(url: string) {
  return new NextRequest(new URL(url, "http://localhost:3000"));
}

describe("GET /api/queries", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("@/db", () => {
      const mockDb = createDbMock({
        selectResults: [
          [
            {
              id: "550e8400-e29b-41d4-a716-446655440000",
              title: "Rare Vase",
              image_key: "abc123",
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
  });

  it("returns paginated query items", async () => {
    const { GET } = await import("@/app/api/queries/route");
    const response = await GET(makeRequest("/api/queries"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].title).toBe("Rare Vase");
    expect(body.nextCursor).toBeNull();
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

  it("clamps limit between 1 and 50", async () => {
    const { db } = await import("@/db");
    const { GET } = await import("@/app/api/queries/route");

    await GET(makeRequest("/api/queries?limit=999"));

    const chain = vi.mocked(db.select).mock.results.at(-1)?.value.from.mock
      .results.at(-1)?.value;
    expect(chain?.limit).toHaveBeenCalledWith(51);
  });
});
