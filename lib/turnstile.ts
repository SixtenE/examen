import { SeverityNumber } from "@opentelemetry/api-logs";
import { trackServerEvent } from "@/lib/telemetry";

const SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TOKEN_MAX = 2048;
const ACTION = "upload";
const FAILED = "Couldn't verify this upload. Try again.";
const UNAVAILABLE = "Verification unavailable. Try again shortly.";

type SiteverifyResult = {
  success?: boolean;
  action?: string;
};

function visitorIp(request: Request) {
  const cloudflare = request.headers.get("cf-connecting-ip")?.trim();
  if (cloudflare) return cloudflare;

  const forwarded = request.headers
    .get("x-forwarded-for")
    ?.split(",")
    .at(-1)
    ?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || undefined;
}

function reject(
  request: Request,
  status: number,
  error: string,
  reason: string,
) {
  trackServerEvent(
    request,
    "turnstile_rejected",
    { reason, status: "rejected" },
    status === 503 ? SeverityNumber.ERROR : SeverityNumber.WARN,
  );
  return Response.json({ error }, { status });
}

export async function enforceTurnstile(request: Request) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    // ponytail: unset secret skips the check outside production. Set the secret to enforce locally.
    if (process.env.NODE_ENV === "production") {
      return reject(request, 503, UNAVAILABLE, "not_configured");
    }
    return null;
  }

  const token = request.headers.get("cf-turnstile-response")?.trim() ?? "";
  if (!token || token.length > TOKEN_MAX) {
    return reject(request, 403, FAILED, token ? "malformed" : "missing");
  }

  let result: SiteverifyResult;
  try {
    const response = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret,
        response: token,
        remoteip: visitorIp(request),
      }),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (!response.ok) {
      return reject(request, 503, UNAVAILABLE, "siteverify_http");
    }
    result = (await response.json()) as SiteverifyResult;
  } catch {
    return reject(request, 503, UNAVAILABLE, "siteverify_unreachable");
  }

  if (result.success !== true) {
    return reject(request, 403, FAILED, "invalid");
  }
  // Dummy test keys omit action. A present action must be this upload.
  if (typeof result.action === "string" && result.action !== ACTION) {
    return reject(request, 403, FAILED, "action");
  }

  return null;
}
