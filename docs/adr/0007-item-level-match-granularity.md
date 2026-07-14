---
status: proposed
---

# Item-level Match granularity with generation-time snapshots

Match generation produces at most one Match per Auctionet Item. When an item has multiple Reference images, only the highest-scoring image is kept. Each Match stores a snapshot of the item's metadata at generation time — title, image URL, Realized Price, currency, Auctionet ID, and similarity score — so revisiting a past Query shows the same results even if the catalog is later re-scraped or re-seeded. Realized Price is nullable when extraction fails; zero must never represent "unknown". The Catalog includes only sold Auctionet Items; sold items with unparseable prices remain searchable with a missing Realized Price.

## Current implementation

Item-level deduplication and generation-time metadata snapshots are implemented. Missing prices are stored as `0` instead of null in Match rows. The embed and seed scripts skip non-sold items; the seed script seeds sold items with a null Realized Price when price extraction fails. The scraper does not yet filter to sold items only.

## Target behavior

- Nullable Realized Price (never `0` for unknown)
- Catalog limited to sold Auctionet Items
- Sold items with unparseable prices included with null Realized Price

## Considered Options

- **One Match per Auctionet Item with best-scoring image** (chosen) — result list represents distinct lots, which matches how valuers think about comparables.
- **One Match per Reference image** — surfaces which specific view matched (mark, signature, damage), but can flood results with multiple images from the same lot.
- **One Match per item with multiple matched views nested inside** — richer detail, but complicates the Match model and UI.
- **Live metadata from Qdrant on every page view** — always current, but past Query results change when the catalog is updated.

## Consequences

Qdrant may return several points for the same Auctionet Item; deduplication happens before persisting Matches. The `matches.price` column should become nullable to align with Realized Price semantics. Match pages link to Auctionet CDN image URLs without project-owned copies; if Auctionet removes an image, old Match pages may break. Description is intentionally omitted from Match snapshots; users follow the source link for full item detail.
