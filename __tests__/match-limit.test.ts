import { describe, expect, it } from "vitest";
import {
  DEFAULT_MATCH_LIMIT,
  MAX_MATCH_LIMIT,
  parseMatchLimit,
} from "../lib/match-limit";

describe("parseMatchLimit", () => {
  it("defaults to 6 when limit is omitted", () => {
    expect(parseMatchLimit(undefined)).toBe(DEFAULT_MATCH_LIMIT);
    expect(parseMatchLimit(null)).toBe(DEFAULT_MATCH_LIMIT);
  });

  it("accepts valid limits within the cap", () => {
    expect(parseMatchLimit(1)).toBe(1);
    expect(parseMatchLimit(12)).toBe(12);
    expect(parseMatchLimit(MAX_MATCH_LIMIT)).toBe(MAX_MATCH_LIMIT);
  });

  it("rejects non-positive or non-integer limits", () => {
    expect(parseMatchLimit(0)).toEqual({
      error: "limit must be a positive integer",
    });
    expect(parseMatchLimit(-1)).toEqual({
      error: "limit must be a positive integer",
    });
    expect(parseMatchLimit(1.5)).toEqual({
      error: "limit must be a positive integer",
    });
    expect(parseMatchLimit("6")).toEqual({
      error: "limit must be a positive integer",
    });
  });

  it("rejects limits above the maximum", () => {
    expect(parseMatchLimit(MAX_MATCH_LIMIT + 1)).toEqual({
      error: `limit must be at most ${MAX_MATCH_LIMIT}`,
    });
  });
});
