import { describe, expect, it } from "vitest";
import { NextResponse } from "next/server";
import {
  getOrCreateQueryOwnerId,
  getQueryOwnerId,
  setQueryOwnerCookie,
} from "@/lib/query-owner";

const VALID_UUID = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
const OTHER_UUID = "550e8400-e29b-41d4-a716-446655440000";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requestWithCookie(cookie?: string) {
  return new Request("http://localhost:3000", {
    headers: cookie === undefined ? {} : { cookie },
  });
}

describe("getQueryOwnerId", () => {
  it("returns null without a cookie header", () => {
    expect(getQueryOwnerId(requestWithCookie())).toBeNull();
  });

  it("returns null when only unrelated cookies exist", () => {
    expect(
      getQueryOwnerId(requestWithCookie("session=abc; theme=dark")),
    ).toBeNull();
  });

  it("returns the owner id from a valid cookie", () => {
    expect(
      getQueryOwnerId(requestWithCookie(`examen-owner=${VALID_UUID}`)),
    ).toBe(VALID_UUID);
  });

  it("finds the owner cookie among other cookies", () => {
    expect(
      getQueryOwnerId(
        requestWithCookie(
          `session=abc; examen-owner=${VALID_UUID}; theme=dark`,
        ),
      ),
    ).toBe(VALID_UUID);
  });

  it.each([
    ["SQL injection", "'; DROP TABLE queries;--"],
    ["empty value", ""],
    ["not a uuid", "not-a-uuid"],
    ["uuid with trailing junk", `${VALID_UUID}junk`],
    ["uuid with leading junk", `x${VALID_UUID.slice(1)}`],
    ["path traversal", "../../etc/passwd"],
  ])("rejects %s in the cookie value", (_label, value) => {
    expect(
      getQueryOwnerId(requestWithCookie(`examen-owner=${value}`)),
    ).toBeNull();
  });

  it("does not match a cookie whose name merely shares the prefix", () => {
    expect(
      getQueryOwnerId(requestWithCookie(`examen-owner-evil=${VALID_UUID}`)),
    ).toBeNull();
  });

  it("does not match a different cookie that ends with the name", () => {
    expect(
      getQueryOwnerId(requestWithCookie(`x-examen-owner=${VALID_UUID}`)),
    ).toBeNull();
  });

  it("uses the first cookie when the name is duplicated", () => {
    expect(
      getQueryOwnerId(
        requestWithCookie(
          `examen-owner=${VALID_UUID}; examen-owner=${OTHER_UUID}`,
        ),
      ),
    ).toBe(VALID_UUID);
  });
});

describe("getOrCreateQueryOwnerId", () => {
  it("reuses a valid cookie value", () => {
    expect(
      getOrCreateQueryOwnerId(requestWithCookie(`examen-owner=${VALID_UUID}`)),
    ).toBe(VALID_UUID);
  });

  it("generates a fresh UUID instead of trusting an invalid cookie", () => {
    const ownerId = getOrCreateQueryOwnerId(
      requestWithCookie("examen-owner='; DROP TABLE queries;--"),
    );

    expect(ownerId).toMatch(UUID_PATTERN);
  });

  it("generates distinct ids for distinct anonymous visitors", () => {
    const first = getOrCreateQueryOwnerId(requestWithCookie());
    const second = getOrCreateQueryOwnerId(requestWithCookie());

    expect(first).toMatch(UUID_PATTERN);
    expect(second).toMatch(UUID_PATTERN);
    expect(first).not.toBe(second);
  });
});

describe("setQueryOwnerCookie", () => {
  it("sets a hardened session cookie", () => {
    const response = NextResponse.json({ ok: true });
    setQueryOwnerCookie(response, VALID_UUID);

    const setCookie = response.headers.get("set-cookie");
    expect(setCookie).toContain(`examen-owner=${VALID_UUID}`);
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie?.toLowerCase()).toContain("samesite=lax");
    expect(setCookie).toContain(`Max-Age=${60 * 60 * 24 * 365}`);
  });
});
