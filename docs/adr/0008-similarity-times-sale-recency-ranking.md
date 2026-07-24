---
status: accepted
---

# Rank Matches by similarity × sale recency

Match ordering uses `rank = similarity_score × 2^(-age_days / 365)`, not raw cosine alone. The `% match` badge still shows pure visual similarity; recency only affects order and which candidates make the top 32. Sale date comes from the Auctionet Item's `dates.ends_at` (seeded into the Reference payload as `sold_at` and snapshotted onto each Match). Missing dates get a neutral half-life weight (0.5) so undated comps neither dominate nor disappear. A one-year half-life keeps recent auction comps ahead without burying strong older visual matches.

## Considered Options

- **Similarity × exponential sale recency** (chosen) — standard decay ranking; one tunable half-life; display % stays honest.
- **Similarity only, recent-first as tie-break** — too weak; near-identical old sales would still bury useful recent comps.
- **Weighted sum of similarity and recency** — easy to let mediocre recent sales outrank strong visual matches; needs extra weight knobs.
- **Overwrite similarity_score with a blended rank** — corrupts the `% match` signal users read as visual likeness.
