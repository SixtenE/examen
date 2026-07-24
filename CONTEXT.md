# Examen

An app for finding catalog images that are visually similar to an image a user uploads, using vector similarity search.

## Language

**Catalog**:
The searchable set of sold Auctionet Items whose images have been embedded as References. A Query searches the Catalog to produce Matches.
_Avoid_: Dataset, corpus, index

**Auctionet Category**:
A partition of the Catalog defined by one Auctionet search category (for example ceramics and porcelain, or paintings). Each category is seeded into its own Qdrant collection; Match generation searches all configured categories and ranks results globally.
_Avoid_: Collection, department, section

**Reference**:
A pre-embedded image from a sold Auctionet Item in the Catalog. Stored ahead of time with its vector; never created by a user upload.
_Avoid_: Catalog image, dataset image, Image

**Query**:
The persisted search entity created when a user uploads an image. Upload stores the bytes and creates the row; the Query is embedded during Match generation.
_Avoid_: Photo, Image
_Note_: `upload` names the user action; **Query** names the persisted entity.

**Match generation**:
The embed + vector search + persist step that produces Matches for a Query. Triggered by the upload form; observed on the Query page.
_Avoid_: Matching, search, indexing

**Match**:
A stored result linking one Query to one Auctionet Item, carrying a similarity score, an optional Sale Date, and a snapshot of that item's metadata at generation time. When an item has multiple Reference images, Match generation keeps only the highest-scoring image for that item. Match lists are ordered by visual similarity tempered by Sale Date recency; the similarity score itself remains a pure visual measure.
_Avoid_: Result, hit

**Sale Date**:
When the Auctionet Item's auction ended (sold). Used to prefer recent comps when ranking Matches; nullable when the source data has no parseable end time.
_Avoid_: Sold at, ends at, listing date

**Realized Price**:
The final sale amount for a sold Auctionet Item. Nullable when the amount could not be extracted from source data; never represented as zero to mean "unknown".
_Avoid_: Price, estimate, hammer price

**Key**:
The opaque `nanoid` identifier under which a Query image's bytes are stored in the S3 bucket. The single link between a stored image and its bytes.
_Avoid_: Filename, path, name

**Auctionet ID**:
The external catalog identifier for an Auctionet Item. Persisted on each Match so past results can link back to the catalog item without a live Qdrant lookup.
_Avoid_: Item id, lot id

**Auctionet Item**:
The external catalog entity on Auctionet whose metadata is scraped and whose images become References. Only sold items belong in the Catalog.
_Avoid_: Listing, lot, catalog entry

**Vector Artifact**:
The on-disk JSON holding one Auctionet Item's pre-computed Reference embeddings, produced by the embed script and consumed by seeding. Not the catalog itself; Qdrant is.
_Avoid_: Vector file, embeddings file
