# Deterministic Qdrant Reference point IDs

Reference points in Qdrant use deterministic numeric IDs derived from their source Auctionet Item and image position: `auctionet_id * 100 + image_index`. The seed script validates that `image_index < 100` before upload. This makes seeding idempotent: re-uploading the same Reference overwrites the existing point instead of creating a duplicate.

## Considered Options

- **Deterministic numeric IDs** (chosen) — compact, debuggable, and reversible enough for local inspection. The `image_index < 100` invariant keeps point IDs collision-free for the observed Auctionet Item image counts.
- **UUIDv5 from `auctionet_id:image_index`** — also deterministic and collision-resistant, but less readable during debugging and no safer for the current source data.
- **Random UUIDs with a local checkpoint file** — avoids accidental overwrites, but interruptions can create duplicates and checkpoint state can drift from Qdrant after a collection rebuild.
- **Always re-upload everything without skip logic** — correct with deterministic IDs, but wasteful for the 3.2 GB Vector Artifact corpus.

## Consequences

Changing the point ID scheme later is a data migration, not a harmless refactor: old and new IDs would coexist in Qdrant and duplicate the catalog unless the collection is recreated. Resume behavior uses Qdrant as the source of truth: for each Vector Artifact, the seed script retrieves the expected point IDs and skips the artifact only when every point already exists. A `--force` run bypasses that check and overwrites points with the current artifact payload.
