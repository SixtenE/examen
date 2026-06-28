export class RateLimitError extends Error {
  retryAfterSeconds: number | null;

  constructor(message: string, retryAfterSeconds: number | null) {
    super(message);
    this.name = "RateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

type ErrorBody = {
  error?: unknown;
};

function parseRetryAfter(response: Response) {
  const value = (response.headers as Headers | undefined)?.get("Retry-After");
  if (!value) {
    return null;
  }

  const seconds = Number.parseInt(value, 10);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

async function readErrorMessage(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as ErrorBody;
    return typeof body.error === "string" && body.error.length > 0
      ? body.error
      : fallback;
  } catch {
    return fallback;
  }
}

export function isRateLimitError(error: unknown): error is RateLimitError {
  return error instanceof RateLimitError;
}

export async function throwApiError(response: Response, fallback: string) {
  if (response.ok) {
    return;
  }

  const retryAfterSeconds = parseRetryAfter(response);
  const message = await readErrorMessage(response, fallback);

  if (response.status === 429) {
    throw new RateLimitError(message, retryAfterSeconds);
  }

  throw new Error(message);
}

export function getApiErrorMessage(error: unknown, fallback: string) {
  if (isRateLimitError(error)) {
    return error.retryAfterSeconds
      ? `Too many requests. Try again in ${error.retryAfterSeconds} seconds.`
      : "Too many requests. Try again shortly.";
  }

  return error instanceof Error && error.message.length > 0
    ? error.message
    : fallback;
}
