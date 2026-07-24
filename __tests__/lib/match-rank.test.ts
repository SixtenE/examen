import { afterEach, describe, expect, it, vi } from "vitest";
import { parseSoldAtUnix, rankScore } from "@/lib/match-rank";

describe("rankScore", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("prefers a recent mid score over an old high score", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-24T12:00:00Z"));

    const recent = rankScore(0.85, new Date("2026-06-24T12:00:00Z"));
    const old = rankScore(0.92, new Date("2021-07-24T12:00:00Z"));

    expect(recent).toBeGreaterThan(old);
  });

  it("treats missing Sold At as maximally stale", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-24T12:00:00Z"));

    const missing = rankScore(0.99, null);
    const dated = rankScore(0.5, new Date("2020-01-01T00:00:00Z"));

    expect(missing).toBe(0);
    expect(missing).toBeLessThan(dated);
  });
});

describe("parseSoldAtUnix", () => {
  it("parses unix seconds into a Date", () => {
    expect(parseSoldAtUnix(1600430400)?.toISOString()).toBe(
      "2020-09-18T12:00:00.000Z",
    );
  });

  it("returns null for invalid values", () => {
    expect(parseSoldAtUnix(null)).toBeNull();
    expect(parseSoldAtUnix(0)).toBeNull();
    expect(parseSoldAtUnix(-1)).toBeNull();
    expect(parseSoldAtUnix("1600430400")).toBeNull();
  });
});
