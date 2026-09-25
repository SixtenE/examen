# Daily catalog pipeline on Railway cron

The searchable Catalog is rebuilt incrementally by Railway cron services. Scraped Auctionet Item JSON and Vector Artifacts are the durable intermediate state in a Railway Bucket (S3-compatible); Qdrant remains the source of truth for Reference vectors used at search time. The orchestrator (`pnpm cron`) selects stages with `--stages scrape,embed,store,upsert` (default: all four). Scrape writes item JSON straight to the bucket (`HeadObject` skip / `PutObject`); embed and upsert still sync needed objects onto the ephemeral cron disk. Store uploads only missing Vector Artifacts afterward, and upsert skips existing deterministic Qdrant point IDs. Bucket→local syncs are implicit plumbing whenever embed, store, or upsert is selected.

## Considered Options

- **Railway cron + bucket-backed intermediates** (chosen) — matches the existing scrape → embed → seed scripts, survives ephemeral disks, and stays idle between runs.
- **Always-on worker with a local volume** — simpler resume on disk, but pays for idle compute and couples durability to one volume.
- **Re-scrape and re-embed everything daily** — no bucket skip checks, but wastes Auctionet fetches and OpenRouter spend.

## Consequences

The web service and catalog cron services must be separate Railway services. The scrape-only service uses `railway.scrape.toml` (`cronSchedule = */30 * * * *`, `--stages scrape`). The separate indexing service uses `railway.catalog.toml` (daily at 02:00 UTC, `--stages embed,store,upsert`). Start with a manual single-category run, then an uncapped catch-up before enabling the schedule. The embed stage independently checks Qdrant when invoked by the orchestrator, so an item skipped during preparation is also skipped on a fresh disk. Bucket keys live under `scrape/...` so they never collide with Query image Keys. Operators configure categories with `CATALOG_CATEGORIES` (default: the full Auctionet leaf taxonomy). A run that overlaps the next schedule is skipped by Railway, so each run's scrape/embed budget must fit inside its own interval (30 minutes for scrape-only) or use `--max-pages` / `--max-items` while bootstrapping.

The scheduled scrape uses backfill with a 500-new-item budget. Every category is traversed in oldest/newest end-date and ascending/descending estimate order to reach beyond an individual listing’s page cap. Duplicate Auctionet IDs are skipped within the run and existing item objects are skipped in the bucket. Runs restart listings rather than persisting page positions. An uncapped, unbudgeted completion must cover the advertised count; otherwise scraping fails visibly instead of silently accepting an incomplete archive. Sort-order unions cannot guarantee coverage for arbitrarily large categories; such failures require narrower filters.
