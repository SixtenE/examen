import { logs } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BatchLogRecordProcessor,
  LoggerProvider,
} from "@opentelemetry/sdk-logs";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import {
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";

const projectToken = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
const host = (
  process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com"
).replace(/\/$/, "");

const resource = resourceFromAttributes({
  [ATTR_SERVICE_NAME]: "examen-web",
  [ATTR_SERVICE_VERSION]:
    process.env.RAILWAY_GIT_COMMIT_SHA ??
    process.env.VERCEL_GIT_COMMIT_SHA ??
    "dev",
  [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: process.env.NODE_ENV ?? "development",
});

export const loggerProvider = new LoggerProvider({
  resource,
  processors: projectToken
    ? [
        new BatchLogRecordProcessor({
          exporter: new OTLPLogExporter({
            url: `${host}/i/v1/logs`,
            headers: {
              Authorization: `Bearer ${projectToken}`,
              "Content-Type": "application/json",
            },
          }),
        }),
      ]
    : [],
});

export const tracerProvider = new NodeTracerProvider({
  resource,
  spanProcessors: projectToken
    ? [
        new BatchSpanProcessor(
          new OTLPTraceExporter({
            url: `${host}/i/v1/traces`,
            headers: {
              Authorization: `Bearer ${projectToken}`,
            },
          }),
        ),
      ]
    : [],
});

if (projectToken) {
  logs.setGlobalLoggerProvider(loggerProvider);
  tracerProvider.register();
}

export async function flushOpenTelemetry() {
  if (!projectToken) return;
  await Promise.all([loggerProvider.forceFlush(), tracerProvider.forceFlush()]);
}
