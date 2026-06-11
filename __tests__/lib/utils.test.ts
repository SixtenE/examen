import { afterEach, describe, expect, it, vi } from "vitest";
import { cn, isUuid, relativeTimeUntilNow } from "@/lib/utils";

describe("isUuid", () => {
  it("accepts valid UUIDs", () => {
    expect(isUuid("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
    expect(isUuid("6ba7b810-9dad-11d1-80b4-00c04fd430c8")).toBe(true);
  });

  it("rejects invalid values", () => {
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid("550e8400-e29b-41d4-a716")).toBe(false);
    expect(isUuid("")).toBe(false);
  });
});

describe("cn", () => {
  it("merges class names and resolves tailwind conflicts", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
    expect(cn("text-red-500", false && "hidden", "font-bold")).toBe(
      "text-red-500 font-bold",
    );
  });
});

describe("relativeTimeUntilNow", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns '<1 minute ago' for recent past dates", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-11T12:00:00Z"));

    expect(relativeTimeUntilNow(new Date("2026-06-11T11:59:30Z"))).toBe(
      "<1 minute ago",
    );
  });

  it("returns '<1 minute from now' for near-future dates", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-11T12:00:00Z"));

    expect(relativeTimeUntilNow(new Date("2026-06-11T12:00:30Z"))).toBe(
      "<1 minute from now",
    );
  });

  it("formats minutes in the past", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-11T12:00:00Z"));

    expect(relativeTimeUntilNow(new Date("2026-06-11T11:55:00Z"))).toBe(
      "5 minutes ago",
    );
  });

  it("accepts ISO date strings", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-11T12:00:00Z"));

    expect(relativeTimeUntilNow("2026-06-11T11:00:00Z")).toBe("1 hour ago");
  });
});
