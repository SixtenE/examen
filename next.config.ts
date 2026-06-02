import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "compact-envelope-mcwhvmbc.t3.storageapi.dev",
        pathname: "/**",
      },
    ],
  },
};

export default nextConfig;
