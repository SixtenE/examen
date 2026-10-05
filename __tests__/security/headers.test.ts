import { describe, expect, it } from "vitest";
import type { NextConfig } from "next";

type HeaderRule = {
  source: string;
  headers: { key: string; value: string }[];
};

async function resolveHeaderRules(): Promise<HeaderRule[]> {
  const configExport = (await import("../../next.config")).default as
    | NextConfig
    | ((
        phase: string,
        context: { defaultConfig: NextConfig },
      ) => Promise<NextConfig>);

  // The PostHog wrapper turns the config into a phase function.
  const config =
    typeof configExport === "function"
      ? await configExport("phase-production-build", { defaultConfig: {} })
      : configExport;

  return (await config.headers?.()) as HeaderRule[];
}

function headerMap(rules: HeaderRule[]) {
  const map = new Map<string, string>();
  for (const rule of rules) {
    for (const header of rule.headers) {
      map.set(header.key.toLowerCase(), header.value);
    }
  }
  return map;
}

describe("HTTP security headers", () => {
  it("applies the core header set to every path", async () => {
    const rules = await resolveHeaderRules();

    const catchAll = rules.find((rule) => rule.source === "/:path*");
    expect(catchAll).toBeDefined();

    const headers = headerMap(rules);
    expect(headers.get("x-frame-options")).toBe("DENY");
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("strict-transport-security")).toContain("max-age=");
    expect(headers.get("referrer-policy")).toBe(
      "strict-origin-when-cross-origin",
    );
    expect(headers.get("permissions-policy")).toContain("camera=()");
    expect(headers.get("permissions-policy")).toContain("microphone=()");
    expect(headers.get("permissions-policy")).toContain("geolocation=()");
  });

  it("serves a restrictive Content-Security-Policy", async () => {
    const rules = await resolveHeaderRules();
    const csp = headerMap(rules).get("content-security-policy");

    expect(csp).toBeDefined();
    const directives = Object.fromEntries(
      csp!
        .split(";")
        .map((part) => part.trim())
        .filter(Boolean)
        .map((directive) => {
          const [name, ...values] = directive.split(/\s+/);
          return [name, values];
        }),
    );

    expect(directives["default-src"]).toEqual(["'self'"]);
    expect(directives["object-src"]).toEqual(["'none'"]);
    expect(directives["base-uri"]).toEqual(["'self'"]);
    expect(directives["form-action"]).toEqual(["'self'"]);
    expect(directives["frame-ancestors"]).toEqual(["'none'"]);
    // No remote script origins: third-party JS is the classic XSS exfil path.
    expect(directives["script-src"]).not.toContain("https:");
    // Images may only load from the app, inline data, or the two CDNs.
    const imgSrc = directives["img-src"] ?? [];
    expect(imgSrc).toContain("'self'");
    for (const value of imgSrc.filter((v) => v.startsWith("https:"))) {
      expect([
        "https://compact-envelope-mcwhvmbc.t3.storageapi.dev",
        "https://images.auctionet.com",
      ]).toContain(value);
    }
    // Production hardens against protocol downgrade.
    expect(directives["upgrade-insecure-requests"]).toBeDefined();
  });

  it("only proxies PostHog endpoints, never arbitrary destinations", async () => {
    const configExport = (await import("../../next.config")).default as (
      phase: string,
      context: { defaultConfig: NextConfig },
    ) => Promise<NextConfig>;
    const config = await configExport("phase-production-build", {
      defaultConfig: {},
    });
    const rewrites = (await config.rewrites?.()) as {
      source: string;
      destination: string;
    }[];

    for (const rewrite of rewrites) {
      expect(rewrite.source.startsWith("/e7n")).toBe(true);
      expect(rewrite.destination.startsWith("https://")).toBe(true);
      expect(rewrite.destination).toContain("posthog.com");
    }
  });
});
