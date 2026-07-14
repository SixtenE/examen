# Qdrant for vector storage instead of pgvector

We already run Postgres (with `pgvector` available), yet we store Reference vectors and run similarity search in a separate Qdrant instance hosted on Railway. Postgres keeps only the Query and Match history; Qdrant is the source of truth for the catalog (one point per Reference in the `references` collection: a 3072-dim vector + payload). We chose Qdrant for first-class vector search ergonomics (named collections, cosine distance, filtering, upserts) and to keep the vector workload off the primary relational database.

## Considered Options

- **Qdrant as a dedicated vector store** (chosen) — purpose-built ANN search, clean client API, scales independently of Postgres.
- **pgvector in the existing Postgres** — one fewer service and no cross-store consistency to reason about, but couples vector search to the relational DB and caps ANN indexes at 2000 dims.
- **In-app brute-force cosine** — trivial for a tiny catalog, but doesn't scale and reimplements what a vector DB gives for free.

## Consequences

Data is split across two stores: Qdrant holds Reference vectors while Postgres holds Query and Match history. Match rows persist the Reference's **Auctionet ID** and raw similarity score so rendering past results never needs a live Qdrant lookup. Seeding consumes Vector Artifacts and writes to Qdrant through the `seed:references` script. Seeding and querying must use the same model and dimension (currently `google/gemini-embedding-2` at 3072 dimensions) or distances are meaningless. Category-specific collections with federated search are proposed in [ADR 0005](./0005-federated-category-collections.md); until then, the catalog lives in a single `references` collection.
