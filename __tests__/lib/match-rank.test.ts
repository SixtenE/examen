import { describe, expect, it } from "vitest";
import { parseSoldAtUnix } from "@/lib/match-rank";

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
