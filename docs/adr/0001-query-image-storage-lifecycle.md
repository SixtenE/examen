---
status: proposed
---

# Query image storage lifecycle

Query images are stored in S3 under an opaque Key; Postgres holds the Query row that references that Key. Upload writes S3 first, then inserts the row. If the insert fails, a best-effort compensating S3 delete runs so bytes are not left without a Query. Deletion is the inverse: delete S3 bytes first; only remove the Postgres row (and its Matches) after S3 succeeds. If S3 deletion fails, the Query row stays so deletion can be retried.

## Considered Options

- **S3-first with compensating cleanup on upload; S3-first with abort on delete** (chosen) — no distributed transaction across stores, but each operation has a clear failure mode and retry path.
- **Postgres-first on upload** — avoids orphaned S3 objects on insert failure, but leaves Queries without bytes if S3 fails after insert.
- **Delete Postgres row regardless of S3 outcome** — simpler delete handler, but accumulates orphaned bytes.
- **Background cleanup for orphaned objects** — most robust at scale, but adds infrastructure unjustified for this prototype.

## Consequences

Upload already implements compensating S3 delete on failed insert (see `app/api/upload/route.ts`). Query deletion still needs to be updated to delete S3 before Postgres and to preserve the row on S3 failure. There is no cross-store transaction; operators may occasionally need to reconcile orphaned objects if compensating cleanup itself fails.
