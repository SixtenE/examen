# Match generation is upload-triggered, observed on the Query page via a status lifecycle

Uploading a Query returns immediately after the bytes land in S3 and the row is written. The upload form then fires a fire-and-forget matching `POST` so generation starts before navigation completes. The `/queries/[id]` page is the primary observer: it polls the Query's `status` (`pending | processing | ready | failed`) and Matches every 2s while waiting, and only fires the matching `POST` itself as a fallback when the Query is `pending` or `failed` (direct links, retries). We did this so matching begins as early as possible while the user lands on the result page instantly and watches Matches appear there, rather than staring at a blocked upload form during the (slow) embed + Qdrant search.

## Considered Options

- **Upload-triggered with page fallback and a status column** (chosen) — matching starts on upload; the detail page polls and only re-triggers for edge cases; persisted `status` cleanly distinguishes "still matching" from "genuinely zero matches".
- **Page-driven generation only** (previous behavior) — works, but matching starts later because it waits for navigation and page mount.
- **Synchronous-on-upload** — simplest, but the upload form blocks for the full embedding + search and the user can't see the Query until it finishes.
- **`?fresh=1` navigation hint** — no schema change, but spoofable, doesn't survive refresh, and can't tell a permanently-failed Query from a new one.
- **Background worker / queue** — most robust for long jobs, but adds infrastructure unjustified at this scale.

## Consequences

`queries` carries a `query_status` enum. The matching `POST` atomically claims a Query (`status -> processing` only when not already processing) so concurrent callers can't both run the expensive search; a duplicate request while already processing gets `200 { status: "processing" }`. The detail page polls the Query and Matches every 2s until `ready`/`failed` or Matches arrive. On error the row is marked `failed`; revisiting the page re-triggers generation via the fallback POST.
