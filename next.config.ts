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

const nextConfig: NextConfig = {
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
