import { describe, expect, it } from "vitest";
import {
  compareMatchesByRank,
  matchRankScore,
  saleRecency,
  SALE_RECENCY_HALF_LIFE_DAYS,
} from "@/lib/rank-matches";

const NOW = new Date("2026-07-20T12:00:00Z");

describe("saleRecency", () => {
  it("is 1 for a sale happening now", () => {
    expect(saleRecency(NOW, NOW)).toBe(1);
  });

  it("is 0.5 at the half-life", () => {
    const soldAt = new Date(NOW);
    soldAt.setUTCDate(soldAt.getUTCDate() - SALE_RECENCY_HALF_LIFE_DAYS);
    expect(saleRecency(soldAt, NOW)).toBeCloseTo(0.5, 5);
  });

  it("treats missing dates as half-life neutral", () => {
    expect(saleRecency(null, NOW)).toBe(0.5);
    expect(saleRecency(undefined, NOW)).toBe(0.5);
    expect(saleRecency("not-a-date", NOW)).toBe(0.5);
  });
});

describe("matchRankScore", () => {
  it("multiplies similarity by recency", () => {
    const recent = matchRankScore(0.8, NOW, NOW);
    const yearOld = matchRankScore(
      0.8,
      new Date(NOW.getTime() - SALE_RECENCY_HALF_LIFE_DAYS * 86_400_000),
      NOW,
    );

    expect(recent).toBeCloseTo(0.8, 5);
    expect(yearOld).toBeCloseTo(0.4, 5);
  });

  it("lets a slightly weaker but much newer sale outrank an old near-match", () => {
    const oldNearMatch = {
      similarity_score: 0.95,
      sold_at: new Date(NOW.getTime() - 3 * SALE_RECENCY_HALF_LIFE_DAYS * 86_400_000),
    };
    const recentGoodMatch = {
      similarity_score: 0.85,
      sold_at: NOW,
    };

    expect(compareMatchesByRank(recentGoodMatch, oldNearMatch, NOW)).toBeLessThan(0);
    expect(matchRankScore(recentGoodMatch.similarity_score, recentGoodMatch.sold_at, NOW)).toBeGreaterThan(
      matchRankScore(oldNearMatch.similarity_score, oldNearMatch.sold_at, NOW),
    );
  });
});
