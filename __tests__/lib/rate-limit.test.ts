import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockRedisClient = vi.hoisted(() => ({
  connect: vi.fn(),
  on: vi.fn(),
  sendCommand: vi.fn(),
}));
const mockCreateClient = vi.hoisted(() => vi.fn(() => mockRedisClient));

vi.mock("redis", () => ({
  createClient: mockCreateClient,
}));

function makeRequest(ip = "203.0.113.7") {
  return new Request("http://localhost:3000/api/test", {
    headers: {
      "x-forwarded-for": `${ip}, 198.51.100.1`,
    },
  });
}

describe("rate limit helper", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.REDIS_URL = "redis://localhost:6379";
    delete process.env.API_RATE_LIMIT_REQUESTS;
    delete process.env.API_RATE_LIMIT_WINDOW_SECONDS;
    mockRedisClient.connect.mockResolvedValue(mockRedisClient);
    mockRedisClient.on.mockReturnValue(mockRedisClient);
    mockRedisClient.sendCommand.mockResolvedValue([1, 60_000]);
  });

  afterEach(() => {
    delete process.env.REDIS_URL;
    delete process.env.API_RATE_LIMIT_REQUESTS;
    delete process.env.API_RATE_LIMIT_WINDOW_SECONDS;
  });

  it("allows requests under the configured limit", async () => {
    const { enforceRateLimit } = await import("@/lib/rate-limit");

    const response = await enforceRateLimit(makeRequest(), {
      scope: "api:test",
      limit: 2,
      windowSeconds: 60,
    });

    expect(response).toBeNull();
    expect(mockCreateClient).toHaveBeenCalledWith(
      expect.objectContaining({ url: "redis://localhost:6379" }),
    );
    expect(mockRedisClient.sendCommand).toHaveBeenCalledWith([
      "EVAL",
      expect.any(String),
      "1",
      expect.stringMatching(/^rate-limit:api:test:[a-f0-9]{64}$/),
      "60000",
    ]);
  });

  it("returns a 429 response with rate limit headers when over limit", async () => {
    mockRedisClient.sendCommand.mockResolvedValueOnce([3, 45_000]);
    const { enforceRateLimit } = await import("@/lib/rate-limit");

    const response = await enforceRateLimit(makeRequest(), {
      scope: "api:test",
      limit: 2,
      windowSeconds: 60,
    });

    expect(response?.status).toBe(429);
    expect(response?.headers.get("RateLimit-Limit")).toBe("2");
    expect(response?.headers.get("RateLimit-Remaining")).toBe("0");
    expect(response?.headers.get("Retry-After")).toBe("45");
    await expect(response?.json()).resolves.toEqual({
      error: "Too many requests",
    });
  });

  it("allows requests without Redis configuration", async () => {
    delete process.env.REDIS_URL;
    const { enforceRateLimit } = await import("@/lib/rate-limit");

    const response = await enforceRateLimit(makeRequest(), {
      scope: "api:test",
      limit: 1,
      windowSeconds: 60,
    });

    expect(response).toBeNull();
    expect(mockCreateClient).not.toHaveBeenCalled();
  });
});
