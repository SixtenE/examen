# Match generation is triggered by the Query page, tracked via a status lifecycle

Uploading a Query now returns immediately after the bytes land in S3 and the row is written; it no longer waits for matching. Instead, the `/queries/[id]` page drives generation: it reads the Query's `status` (`pending | processing | ready | failed`), fires the matching `POST` itself when the Query is `pending`, and renders a loading state until the result arrives. We did this so the user lands on the result page instantly and watches matches stream in there, rather than staring at a blocked upload form during the (slow) embed + Qdrant search.

## Considered Options

- **Page-driven generation with a status column** (chosen) — fast navigation, the same page serves fresh and revisited Queries, and the persisted `status` cleanly distinguishes "still matching" from "genuinely zero matches".
- **Synchronous-on-upload** (previous behavior) — simplest, but the upload form blocks for the full embedding + search and the user can't see the Query until it finishes.
- **`?fresh=1` navigation hint** — no schema change, but spoofable, doesn't survive refresh, and can't tell a permanently-failed Query from a new one.
- **Background worker / queue** — most robust for long jobs, but adds infrastructure unjustified at this scale.

## Consequences

`queries` carries a `query_status` enum. The matching `POST` atomically claims a Query (`status -> processing` only when not already processing) so concurrent loads can't both run the expensive search; the loser gets `409`. A second observer (refresh / another tab) that sees `processing` polls the Query every 2s until it flips to `ready`/`failed` rather than re-triggering. On error the row is marked `failed` and the page offers a Retry.
