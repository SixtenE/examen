import { trace, SpanStatusCode, type Attributes } from "@opentelemetry/api";
import {
  logs,
  SeverityNumber,
  type AnyValueMap,
} from "@opentelemetry/api-logs";
import { after } from "next/server";
import { PostHog } from "posthog-node";

import { flushOpenTelemetry } from "@/instrumentation.node";

type TelemetryValue = string | number | boolean;
export type TelemetryProperties = Record<
  string,
  TelemetryValue | null | undefined
>;

type RequestErrorInfo = {
  path: string;
  method: string;
  headers?: Record<string, string | string[] | undefined>;
};

type RequestErrorContext = {
  routerKind: string;
  routePath: string;
  routeType: string;
  renderSource?: string;
  revalidateReason?: string;
  renderType?: string;
};

const projectToken = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
const host = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";
const logger = logs.getLogger("examen-web");
const tracer = trace.getTracer("examen-web");

const globalForPostHog = globalThis as typeof globalThis & {
  posthogServer?: PostHog;
};

function getPostHog() {
  if (!projectToken) return null;

  globalForPostHog.posthogServer ??= new PostHog(projectToken, {
    host,
    flushAt: 1,
    flushInterval: 0,
  });

  return globalForPostHog.posthogServer;
}

function compact(properties: TelemetryProperties) {
  return Object.fromEntries(
    Object.entries(properties).filter(
      (entry): entry is [string, TelemetryValue] =>
        entry[1] !== undefined && entry[1] !== null,
    ),
  );
}

function getHeader(
  headers: Headers | Record<string, string | string[] | undefined> | undefined,
  name: string,
) {
  if (!headers) return undefined;
  if (headers instanceof Headers) return headers.get(name) ?? undefined;

  const value = Object.entries(headers).find(
    ([key]) => key.toLowerCase() === name,
  )?.[1];
  return Array.isArray(value) ? value[0] : value;
}

function requestContext(request: {
  headers?: Headers | Record<string, string | string[] | undefined>;
}) {
  return {
    distinctId: getHeader(request.headers, "x-posthog-distinct-id"),
    sessionId: getHeader(request.headers, "x-posthog-session-id"),
  };
}

function emitLog(
  severityNumber: SeverityNumber,
  body: string,
  properties: TelemetryProperties,
) {
  const attributes = compact(properties) as AnyValueMap;
  logger.emit({
    body,
    severityNumber,
    severityText: SeverityNumber[severityNumber],
    attributes,
  });

  if (severityNumber >= SeverityNumber.ERROR) {
    console.error(body, attributes);
  } else if (severityNumber >= SeverityNumber.WARN) {
    console.warn(body, attributes);
  }
}

function errorProperties(error: unknown) {
  const normalized =
    error instanceof Error
      ? error
      : new Error(String(error ?? "Unknown error"));
  return {
    error_type: normalized.name,
    error_message: normalized.message.slice(0, 500),
  };
}

function scheduleTelemetry(task?: () => Promise<void>) {
  const send = async () => {
    await Promise.allSettled([
      task?.() ?? Promise.resolve(),
      flushOpenTelemetry(),
    ]);
  };

  try {
    after(send);
  } catch {
    void send();
  }
}

export function trackServerEvent(
  request: Request,
  event: string,
  properties: TelemetryProperties = {},
  severityNumber = SeverityNumber.INFO,
) {
  const context = requestContext(request);
  const attributes = {
    event,
    status: "success",
    posthogDistinctId: context.distinctId,
    sessionId: context.sessionId,
    ...properties,
  };

  emitLog(severityNumber, event.replaceAll("_", " "), attributes);
  scheduleTelemetry(async () => {
    const posthog = getPostHog();
    if (!posthog || !context.distinctId) return;

    await posthog.captureImmediate({
      distinctId: context.distinctId,
      event,
      properties: {
        ...compact(properties),
        $session_id: context.sessionId,
      },
    });
  });
}

export function trackServerError(
  request: Request,
  error: unknown,
  operation: string,
  properties: TelemetryProperties = {},
) {
  const context = requestContext(request);
  const normalized =
    error instanceof Error
      ? error
      : new Error(String(error ?? "Unknown error"));
  const attributes = {
    event: operation,
    status: "failed",
    posthogDistinctId: context.distinctId,
    sessionId: context.sessionId,
    ...properties,
    ...errorProperties(normalized),
  };

  const span = trace.getActiveSpan();
  span?.recordException(normalized);
  span?.setStatus({ code: SpanStatusCode.ERROR, message: normalized.message });

  emitLog(
    SeverityNumber.ERROR,
    `${operation.replaceAll("_", " ")} failed`,
    attributes,
  );
  scheduleTelemetry(async () => {
    const posthog = getPostHog();
    if (!posthog) return;

    await posthog.captureExceptionImmediate(normalized, context.distinctId, {
      ...compact(properties),
      operation,
      $session_id: context.sessionId,
    });
  });
}

export async function captureUnhandledRequestError(
  error: unknown,
  request: RequestErrorInfo,
  context: RequestErrorContext,
) {
  const normalized =
    error instanceof Error
      ? error
      : new Error(String(error ?? "Unknown error"));
  const analyticsContext = requestContext(request);
  const properties = {
    operation: "unhandled_request",
    method: request.method,
    path: request.path.split("?")[0],
    route: context.routePath,
    route_type: context.routeType,
    router_kind: context.routerKind,
    render_source: context.renderSource,
    render_type: context.renderType,
    revalidate_reason: context.revalidateReason,
    posthogDistinctId: analyticsContext.distinctId,
    sessionId: analyticsContext.sessionId,
    ...errorProperties(normalized),
  };

  emitLog(SeverityNumber.ERROR, "unhandled request failed", properties);

  const posthog = getPostHog();
  await Promise.allSettled([
    posthog?.captureExceptionImmediate(
      normalized,
      analyticsContext.distinctId,
      {
        ...compact(properties),
        $session_id: analyticsContext.sessionId,
      },
    ) ?? Promise.resolve(),
    flushOpenTelemetry(),
  ]);
}

export function withSpan<T>(
  name: string,
  properties: TelemetryProperties,
  operation: () => Promise<T>,
) {
  return tracer.startActiveSpan(
    name,
    { attributes: compact(properties) as Attributes },
    async (span) => {
      try {
        const result = await operation();
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error) {
        const normalized =
          error instanceof Error
            ? error
            : new Error(String(error ?? "Unknown error"));
        span.recordException(normalized);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: normalized.message,
        });
        throw error;
      } finally {
        span.end();
      }
    },
  );
}
