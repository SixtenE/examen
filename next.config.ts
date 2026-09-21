import type { NextConfig } from "next";
import { withPostHogConfig } from "@posthog/nextjs-config";

const posthogHost = (
  process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com"
).replace(/\/$/, "");
const posthogAssetsHost = posthogHost
  .replace("://us.i.posthog.com", "://us-assets.i.posthog.com")
  .replace("://eu.i.posthog.com", "://eu-assets.i.posthog.com");
const uploadSourceMaps = Boolean(
  process.env.POSTHOG_API_KEY && process.env.POSTHOG_PROJECT_ID,
);

const isDev = process.env.NODE_ENV === "development";
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `connect-src 'self'${isDev ? " ws:" : ""}`,
  "img-src 'self' blob: data: https://compact-envelope-mcwhvmbc.t3.storageapi.dev https://images.auctionet.com",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async rewrites() {
    return [
      {
        source: "/e7n/static/:path*",
        destination: `${posthogAssetsHost}/static/:path*`,
      },
      {
        source: "/e7n/array/:path*",
        destination: `${posthogAssetsHost}/array/:path*`,
      },
      {
        source: "/e7n/:path*",
        destination: `${posthogHost}/:path*`,
      },
    ];
  },
  skipTrailingSlashRedirect: true,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "compact-envelope-mcwhvmbc.t3.storageapi.dev",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "images.auctionet.com",
        pathname: "/**",
      },
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          {
            key: "Permissions-Policy",
            value: "camera=(), geolocation=(), microphone=()",
          },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default withPostHogConfig(nextConfig, {
  personalApiKey: process.env.POSTHOG_API_KEY ?? "",
  projectId: process.env.POSTHOG_PROJECT_ID,
  host: posthogHost,
  sourcemaps: {
    enabled: uploadSourceMaps,
    releaseName: "examen-web",
    deleteAfterUpload: true,
  },
});
