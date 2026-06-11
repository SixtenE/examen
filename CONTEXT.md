# Examen

An app for finding catalog images that are visually similar to an image a user uploads, using vector similarity search.

## Language

**Reference**:
A pre-embedded image in the searchable catalog (the dataset). Stored ahead of time with its vector; never created by a user upload.
_Avoid_: Catalog image, dataset image, Image

**Query**:
An image a user uploads in order to search the catalog. Upload stores the bytes and creates the row; the Query is embedded during Match generation.
_Avoid_: Upload, photo, Image

**Match generation**:
The embed + vector search + persist step that produces Matches for a Query. Triggered by the upload form; observed on the Query page.
_Avoid_: Matching, search, indexing

**Match**:
A stored result linking one Query to one Reference, carrying a similarity score. Match generation produces the best Matches.
_Avoid_: Result, hit

**Key**:
The opaque `nanoid` identifier under which an image's bytes are stored in the S3 bucket. The single link between a stored image and its bytes.
_Avoid_: Filename, path, name

**Auctionet ID**:
The external catalog identifier for a Reference on Auctionet. Persisted on each Match so past results can link back to the catalog item without a live Qdrant lookup.
_Avoid_: Item id, lot id

**Auctionet Item**:
The external catalog entity on Auctionet whose metadata is scraped and whose images become References.
_Avoid_: Listing, lot, catalog entry

**Vector Artifact**:
The on-disk JSON holding one Auctionet Item's pre-computed Reference embeddings, produced by the embed script and consumed by seeding. Not the catalog itself; Qdrant is.
_Avoid_: Vector file, embeddings file
