import { expect, it } from "vitest";
import { formatDuration } from "@/lib/format-duration";

it.each([
  [0, "0s"],
  [59_000, "59s"],
  [61_000, "1m 1s"],
  [3_720_000, "1h 2m"],
])("formatDuration(%i) is %s", (ms, expected) => {
  expect(formatDuration(ms)).toBe(expected);
});
