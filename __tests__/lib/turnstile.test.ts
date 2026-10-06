import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = "test-secret";

function request(headers?: Record<string, string>) {
  return new Request("http://localhost/api/upload", { headers });
}

async function loadEnforce() {
  const { enforceTurnstile } = await import("@/lib/turnstile");
  return enforceTurnstile;
}

describe("turnstile upload gate", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("skips verification when the secret is unset outside production", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const enforceTurnstile = await loadEnforce();

    await expect(enforceTurnstile(request())).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed in production when the secret is unset", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const enforceTurnstile = await loadEnforce();

    const response = await enforceTurnstile(request());

    expect(response?.status).toBe(503);
    await expect(response?.json()).resolves.toEqual({
      error: "Verification unavailable. Try again shortly.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a missing or oversized token before calling siteverify", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", SECRET);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const enforceTurnstile = await loadEnforce();

    const missing = await enforceTurnstile(request());
    const oversized = await enforceTurnstile(
      request({ "cf-turnstile-response": "x".repeat(2049) }),
    );

    expect(missing?.status).toBe(403);
    expect(oversized?.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(missing?.json()).resolves.toEqual({
      error: "Couldn't verify this upload. Try again.",
    });
  });

  it("allows a token siteverify accepts, including dummy keys that omit action", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", SECRET);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, hostname: "example.com" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const enforceTurnstile = await loadEnforce();

    const response = await enforceTurnstile(
      request({
        "cf-turnstile-response": "token-ok",
        "cf-connecting-ip": "203.0.113.7",
        "x-forwarded-for": "198.51.100.1",
      }),
    );

    expect(response).toBeNull();
    const body = JSON.parse(
      (fetchMock.mock.calls[0]?.[1] as { body: string }).body,
    ) as { secret: string; response: string; remoteip?: string };
    expect(body).toEqual({
      secret: SECRET,
      response: "token-ok",
      remoteip: "203.0.113.7",
    });
  });

  it("rejects an invalid token or a token minted for another action", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", SECRET);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: false,
          "error-codes": ["invalid-input-response"],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, action: "contact" }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const enforceTurnstile = await loadEnforce();

    const invalid = await enforceTurnstile(
      request({ "cf-turnstile-response": "nope" }),
    );
    const wrongAction = await enforceTurnstile(
      request({ "cf-turnstile-response": "other" }),
    );

    expect(invalid?.status).toBe(403);
    expect(wrongAction?.status).toBe(403);
    const invalidBody = await invalid?.json();
    expect(JSON.stringify(invalidBody)).not.toContain("invalid-input-response");
  });

  it("fails closed when siteverify is unreachable", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", SECRET);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down")),
    );
    const enforceTurnstile = await loadEnforce();

    const response = await enforceTurnstile(
      request({ "cf-turnstile-response": "token-ok" }),
    );

    expect(response?.status).toBe(503);
    await expect(response?.json()).resolves.toEqual({
      error: "Verification unavailable. Try again shortly.",
    });
  });
});
