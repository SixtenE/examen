---
status: accepted
---

# Federated category collections in Qdrant

Each Auctionet Category is seeded into its own Qdrant collection named `references-{auctionet-category-id}-{slug}` (for example `references-9-ceramics-porcelain`). Match generation searches every collection derived from the leaf taxonomy (`AUCTIONET_LEAF_CATEGORIES` → `REFERENCE_COLLECTIONS`), fetches 128 candidate points from each, merges by similarity score, deduplicates by Auctionet Item (keeping the highest-scoring Reference image per item), and returns the global top 32 Matches. All collections must share the same embedding model, dimensions, and distance metric; any collection that fails to search fails the entire generation so rankings stay complete and reproducible.

## Considered Options

- **Category-specific collections with federated global ranking** (chosen) — keeps categories independently seedable while presenting one unified result list to the user.
- **Single shared collection for all categories** — simpler search, but mixes category boundaries and makes partial re-seeding harder.
- **Separate collections with per-category result groups** — preserves category identity in the UI, but forces the user to scan multiple lists.
- **Per-category quotas in federated search** — guarantees representation from each category, but distorts global similarity ranking.

## Consequences

Collection names and the Match generation search list are derived from `AUCTIONET_LEAF_CATEGORIES` via `referenceCollection()`. The catalog pipeline ensures an empty Qdrant collection for every leaf (including never-sold categories for the Auction House) so the fail-hard search rule cannot be tripped by a missing collection. The per-category vectors directory lives inside its category folder (for example `data/auctionet/items/9-ceramics-porcelain/vectors`), and the upsert script derives the collection name from that enclosing category folder. Over-fetching 128 candidates per collection before deduplication is required so the global top 32 still has enough item-level results after collapsing multiple images from the same Auctionet Item. Final list order is recency-weighted; see [ADR 0009](./0009-recency-weighted-match-ranking.md). The legacy `references` collection was migrated onto `references-9-ceramics-porcelain` (snapshot recover, same point IDs), then deleted.
