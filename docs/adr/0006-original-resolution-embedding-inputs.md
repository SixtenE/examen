---
status: proposed
---

# Original-resolution embedding inputs

Both Query and Reference images are embedded at their original resolution. The only preprocessing allowed is format conversion when the embedding API cannot accept the source format (for example converting HEIC uploads to JPEG). No resizing, cropping, or recompression for size reduction. This replaces the current asymmetry where Queries are resized to a 1500px JPEG before embedding while References are embedded directly from Auctionet CDN URLs.

## Current implementation

Queries are resized to a max edge of 1500px and stored as JPEG before embedding. References are embedded from original Auctionet CDN URLs without resizing.

## Considered Options

- **Original resolution with format-only conversion** (chosen) — keeps Query and Reference embeddings comparable without silently changing visual detail.
- **Normalize both sides identically with resizing** — predictable input size and lower embedding cost, but discards detail that may matter for fine-grained similarity (marks, signatures, glaze texture).
- **Keep current asymmetric preprocessing** — no re-embedding cost, but Query and Reference vectors are not directly comparable.
- **Lossless re-encode to a single format without resizing** — consistent format, but still changes byte representation without guaranteeing API compatibility.

## Consequences

Adopting this decision requires re-embedding the entire Reference catalog and updating Query upload preprocessing. Embedding API costs and latency may increase for large images. Format conversion rules must be documented per supported input type so Query and Reference paths stay consistent.
