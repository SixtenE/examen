/** Half-life for sale recency: a year-old sale contributes half as much as one today. */
export const SALE_RECENCY_HALF_LIFE_DAYS = 365;

/**
 * Exponential recency in [0, 1]. Missing / unparseable dates get the half-life
 * value (0.5) so undated comps neither dominate recent sales nor vanish.
 */
export function saleRecency(
  soldAt: Date | string | null | undefined,
  now: Date = new Date(),
): number {
  if (soldAt == null) {
    return 0.5;
  }

  const soldMs = soldAt instanceof Date ? soldAt.getTime() : Date.parse(soldAt);
  if (!Number.isFinite(soldMs)) {
    return 0.5;
  }

  const ageDays = Math.max(0, (now.getTime() - soldMs) / 86_400_000);
  return Math.pow(2, -ageDays / SALE_RECENCY_HALF_LIFE_DAYS);
}

/** Blend visual similarity with sale recency for Match ordering. */
export function matchRankScore(
  similarityScore: number,
  soldAt: Date | string | null | undefined,
  now: Date = new Date(),
): number {
  return similarityScore * saleRecency(soldAt, now);
}

export function compareMatchesByRank<
  T extends { similarity_score: number; sold_at?: Date | string | null },
>(a: T, b: T, now: Date = new Date()): number {
  return (
    matchRankScore(b.similarity_score, b.sold_at, now) -
    matchRankScore(a.similarity_score, a.sold_at, now)
  );
}
