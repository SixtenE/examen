# Daily catalog pipeline on Railway cron

The searchable Catalog is rebuilt incrementally by Railway cron services. Scraped Auctionet Item JSON and Vector Artifacts are the durable intermediate state in a Railway Bucket (S3-compatible); Qdrant remains the source of truth for Reference vectors used at search time. Scrape writes item JSON straight to the bucket (`HeadObject` skip / `PutObject`); embed and seed still sync needed objects onto the ephemeral cron disk. Vector Artifacts upload only missing objects afterward, and seeding skips existing deterministic Qdrant point IDs.

## Considered Options

- **Railway cron + bucket-backed intermediates** (chosen) — matches the existing scrape → embed → seed scripts, survives ephemeral disks, and stays idle between runs.
- **Always-on worker with a local volume** — simpler resume on disk, but pays for idle compute and couples durability to one volume.
- **Re-scrape and re-embed everything daily** — no bucket skip checks, but wastes Auctionet fetches and OpenRouter spend.

## Consequences

The web service and catalog cron services must be separate Railway services. An optional scrape-only service uses `railway.scrape.toml` (`cronSchedule = 0 2 * * *` UTC, `--skip-embed --skip-seed`). The full pipeline uses `railway.catalog.toml` (`cronSchedule = 0 3 * * *` UTC). Bucket keys live under `scrape/...` so they never collide with Query image Keys. Operators configure categories with `CATALOG_CATEGORIES` (default: ceramics/porcelain and paintings). A run that overlaps the next schedule is skipped by Railway, so scrape/embed budgets must finish within 24 hours or use `--max-pages` / `--max-items` while bootstrapping.
