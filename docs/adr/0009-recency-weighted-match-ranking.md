---
status: superseded
---

# Recency-weighted Match ranking

Superseded on 2026-09-25: Matches now rank by descending visual similarity alone, both when selecting the top 32 and when loading saved Matches. Sold At has no effect on ranking, including when missing. The decision below is retained for historical context.

After federated Cosine retrieval and item-level dedupe, Matches are ordered by `similarity × 0.5^(age_days / 365)` using Sold At, not by raw similarity alone. The stored similarity score and “% match” badge stay pure visual similarity; missing Sold At ranks as maximally stale. This changes the final top-32 ordering from ADR 0005 without changing federated retrieval.

## Considered Options

- **Multiplicative half-life decay (chosen)** — recent mid-similarity comps can outrank older near-perfect matches, without inventing a second display score.
- **Pure similarity with date as tie-breaker** — too weak; near-ties are rare so recent sales barely move.
- **Additive hybrid weight** — needs more tuning and can promote weak recent looks more aggressively than needed.
- **Hard similarity floor before recency** — deferred; the Qdrant shortlist is enough for now.
