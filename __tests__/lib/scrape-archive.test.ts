import { beforeEach, expect, it, vi } from "vitest";
import { crawlAuctionet } from "../../scripts/scrape";
import { fetchAuctionetHtml } from "@/lib/auctionet";
import { catalogObjectExists, putCatalogObject } from "@/lib/catalog-bucket";

vi.mock("@/lib/auctionet", async (original) => ({
  ...(await original<typeof import("@/lib/auctionet")>()),
  fetchAuctionetHtml: vi.fn(),
}));
vi.mock("@/lib/catalog-bucket", () => ({
  catalogObjectExists: vi.fn(),
  putCatalogObject: vi.fn(),
}));

const options = {
  url: new URL(
    "https://auctionet.com/en/search/28-paintings?company_id=232&is=ended",
  ),
  segment: "28-paintings",
  force: false,
  delayMs: 0,
  concurrency: 1,
  maxPages: null,
  maxItems: null,
  orders: ["end_asc_archive", "end_desc"],
  incremental: false,
};
const stats = () => ({
  discovered_item_count: 0,
  saved_item_count: 0,
  skipped_item_count: 0,
  failed_item_count: 0,
  failures: [],
});
const page = (ids: number[], count: number, next = false) =>
  `<span class="tabs__show-on-small-displays">(${count})</span>` +
  ids.map((id) => `<a href="/en/${id}-lot">Lot</a>`).join("") +
  (next
    ? '<a rel="next" href="?company_id=232&is=ended&order=end_desc&page=2">Next</a>'
    : "");

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(catalogObjectExists).mockResolvedValue(true);
});

it("continues past a duplicate-only page in another order and skips stored lots", async () => {
  vi.mocked(fetchAuctionetHtml)
    .mockResolvedValueOnce(page([10001, 10002], 3))
    .mockResolvedValueOnce(page([10002, 10001], 3, true))
    .mockResolvedValueOnce(page([10003], 3));
  const result = stats();
  await crawlAuctionet(options, result);
  expect(result.discovered_item_count).toBe(3);
  expect(catalogObjectExists).toHaveBeenCalledTimes(3);
  expect(putCatalogObject).not.toHaveBeenCalled();
});

it("fails visibly if capped orders leave a gap", async () => {
  vi.mocked(fetchAuctionetHtml).mockResolvedValue(page([10001], 3));
  await expect(crawlAuctionet(options, stats())).rejects.toThrow(
    "Incomplete archive",
  );
});

it("saves only new lots and permits a budget-limited partial backfill", async () => {
  vi.mocked(fetchAuctionetHtml)
    .mockResolvedValueOnce(page([10001, 10002], 30))
    .mockResolvedValueOnce("<h1>Historical lot</h1>");
  vi.mocked(catalogObjectExists)
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce(false);
  const result = stats();
  await crawlAuctionet({ ...options, maxItems: 1 }, result);
  expect(result.saved_item_count).toBe(1);
  expect(putCatalogObject).toHaveBeenCalledTimes(1);
  expect(fetchAuctionetHtml).toHaveBeenCalledTimes(2);
});
