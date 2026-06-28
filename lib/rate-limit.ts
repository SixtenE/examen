import { createHash } from "node:crypto";
import { createClient, type RedisClientType } from "redis";

const DEFAULT_RATE_LIMIT_REQUESTS = 60;
const DEFAULT_RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
local ttl = redis.call("PTTL", KEYS[1])
if ttl < 0 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return { count, ttl }
`;

type RateLimitOptions = {
  scope: string;
  limit?: number;
  windowSeconds?: number;
};

type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: Date;
  retryAfterSeconds: number;
};

let redisClientPromise: Promise<RedisClientType> | null = null;

function parsePositiveInteger(value: string | undefined, fallback: number) {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getRateLimitSettings(options: RateLimitOptions) {
  return {
    limit:
      options.limit ??
      parsePositiveInteger(
        process.env.API_RATE_LIMIT_REQUESTS,
        DEFAULT_RATE_LIMIT_REQUESTS,
      ),
    windowSeconds:
      options.windowSeconds ??
      parsePositiveInteger(
        process.env.API_RATE_LIMIT_WINDOW_SECONDS,
        DEFAULT_RATE_LIMIT_WINDOW_SECONDS,
      ),
  };
}

function getRedisClient() {
  const url = process.env.REDIS_URL;
  if (!url) {
    return null;
  }

  if (!redisClientPromise) {
    const client = createClient({
      url,
      socket: {
        reconnectStrategy: (retries) => Math.min(retries * 50, 1000),
      },
    });

    client.on("error", (error) => {
      console.error("redis rate limit error:", error);
    });

    redisClientPromise = client.connect();
  }

  return redisClientPromise;
}

function getRequestIdentifier(request: Request) {
  const headers = request.headers ?? new Headers();
  const forwardedFor = headers.get("x-forwarded-for");
  const ip =
    forwardedFor?.split(",").at(0)?.trim() ||
    headers.get("x-real-ip") ||
    headers.get("cf-connecting-ip") ||
    "anonymous";

  return createHash("sha256").update(ip).digest("hex");
}

function buildRateLimitHeaders(result: RateLimitResult) {
  return {
    "RateLimit-Limit": result.limit.toString(),
    "RateLimit-Remaining": result.remaining.toString(),
    "RateLimit-Reset": Math.ceil(result.resetAt.getTime() / 1000).toString(),
    "Retry-After": result.retryAfterSeconds.toString(),
  };
}

export async function checkRateLimit(
  request: Request,
  options: RateLimitOptions,
): Promise<RateLimitResult> {
  const { limit, windowSeconds } = getRateLimitSettings(options);
  const windowMs = windowSeconds * 1000;
  const resetAt = new Date(Date.now() + windowMs);
  const fallbackResult = {
    allowed: true,
    limit,
    remaining: limit,
    resetAt,
    retryAfterSeconds: 0,
  };

  const redisClient = getRedisClient();
  if (!redisClient) {
    return fallbackResult;
  }

  try {
    const client = await redisClient;
    const key = `rate-limit:${options.scope}:${getRequestIdentifier(request)}`;
    const reply = await client.sendCommand<[number, number]>([
      "EVAL",
      RATE_LIMIT_SCRIPT,
      "1",
      key,
      windowMs.toString(),
    ]);

    const count = Number(reply[0]);
    const ttlMs = Math.max(Number(reply[1]), 0);
    const retryAfterSeconds = Math.ceil(ttlMs / 1000);

    return {
      allowed: count <= limit,
      limit,
      remaining: Math.max(limit - count, 0),
      resetAt: new Date(Date.now() + ttlMs),
      retryAfterSeconds,
    };
  } catch (error) {
    console.error("rate limit check failed:", error);
    return fallbackResult;
  }
}

export async function enforceRateLimit(
  request: Request,
  options: RateLimitOptions,
) {
  const result = await checkRateLimit(request, options);

  if (result.allowed) {
    return null;
  }

  return Response.json(
    { error: "Too many requests" },
    {
      status: 429,
      headers: buildRateLimitHeaders(result),
    },
  );
}
