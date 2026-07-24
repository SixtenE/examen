const HALF_LIFE_DAYS = 365;
const MS_PER_DAY = 86_400_000;

/** Recency-weighted sort key. Missing Sold At ranks as maximally stale. */
export function rankScore(
  similarity: number,
  soldAt: Date | null,
  now = new Date(),
): number {
  if (!soldAt) {
    return 0;
  }

  const ageDays = Math.max(0, (now.getTime() - soldAt.getTime()) / MS_PER_DAY);
  return similarity * Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
}

export function parseSoldAtUnix(value: unknown): Date | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  return new Date(value * 1000);
}
