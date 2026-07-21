# Daily catalog pipeline on Railway cron

The searchable Catalog is rebuilt incrementally once a day by a Railway cron service. Scraped Auctionet Item JSON and Vector Artifacts are the durable intermediate state in a Railway Bucket (S3-compatible); Qdrant remains the source of truth for Reference vectors used at search time. Ephemeral cron disks sync from the bucket before work and upload only missing objects afterward, so each stage can skip duplicates: existing item files, existing bucket keys (`HeadObject`), existing Vector Artifacts, and existing deterministic Qdrant point IDs.

## Considered Options

- **Railway cron + bucket-backed intermediates** (chosen) — matches the existing scrape → embed → seed scripts, survives ephemeral disks, and stays idle between runs.
- **Always-on worker with a local volume** — simpler resume on disk, but pays for idle compute and couples durability to one volume.
- **Re-scrape and re-embed everything daily** — no bucket sync, but wastes Auctionet fetches and OpenRouter spend.

## Consequences

The web service and the catalog cron must be separate Railway services; only the cron service uses `railway.catalog.toml` (`cronSchedule = 0 3 * * *` UTC). Bucket keys live under `catalog/auctionet/items/...` so they never collide with Query image Keys. Operators configure categories with `CATALOG_CATEGORIES` (default: ceramics/porcelain and paintings). A run that overlaps the next schedule is skipped by Railway, so scrape/embed budgets must finish within 24 hours or use `--max-pages` / `--max-items` while bootstrapping.
