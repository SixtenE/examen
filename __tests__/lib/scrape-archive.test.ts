import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { crawlAuctionet } from "../../scripts/scrape";
import { extractNextListingPageUrl, fetchAuctionetHtml } from "@/lib/auctionet";
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
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.mocked(catalogObjectExists).mockResolvedValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

it.each([
  ['rel="next"', "Next"],
  ["", "Nästa"],
  ["", "2"],
])(
  "chooses valid pagination after an unrelated %s %s link",
  (attributes, label) => {
    const current = new URL(
      "?company_id=232&is=ended&order=end_desc&page=1",
      options.url,
    );
    const html =
      `<a ${attributes} href="/en/search/6-glass?company_id=232&is=ended&order=end_desc&page=2">${label}</a>` +
      `<a ${attributes} href="?is=ended&order=end_desc&company_id=232&page=2#lots">${label}</a>`;
    expect(extractNextListingPageUrl(html, current)?.toString()).toBe(
      "https://auctionet.com/en/search/28-paintings?is=ended&order=end_desc&company_id=232&page=2",
    );
  },
);

it.each([
  "https://www.auctionet.com/en/search/28-paintings?company_id=232&is=ended&order=end_desc&page=2",
  "?company_id=233&is=ended&order=end_desc&page=2",
  "?company_id=232&is=ongoing&order=end_desc&page=2",
  "?company_id=232&is=ended&order=estimate_asc&page=2",
  "?company_id=232&is=ended&page=2",
  "?company_id=232&is=ended&order=end_desc&page=2&q=other",
  "?company_id=232&is=ended&order=end_desc&page=1",
  "?company_id=232&is=ended&order=end_desc&page=0",
  "?company_id=232&is=ended&order=end_desc&page=1.5",
])(
  "rejects a next link that changes the listing or goes backward: %s",
  (href) => {
    const current = new URL(
      "?company_id=232&is=ended&order=end_desc&page=1",
      options.url,
    );
    expect(
      extractNextListingPageUrl(
        `<a rel="next" href="${href}">Next</a>`,
        current,
      ),
    ).toBeNull();
  },
);

it("chooses the nearest higher page when only numeric links are available", () => {
  const current = new URL(
    "?company_id=232&is=ended&order=end_desc&page=2",
    options.url,
  );
  const html = [10, 1, 3, 2]
    .map(
      (number) =>
        `<a href="?company_id=232&is=ended&order=end_desc&page=${number}">${number}</a>`,
    )
    .join("");
  expect(
    extractNextListingPageUrl(html, current)?.searchParams.get("page"),
  ).toBe("3");
});

it("continues past a duplicate-only page in another order and skips stored lots", async () => {
  vi.mocked(fetchAuctionetHtml)
    .mockResolvedValueOnce(page([10001, 10002], 3))
    .mockResolvedValueOnce(page([10002, 10001], 3, true))
    .mockResolvedValueOnce(page([10003], 3));
  const result = stats();
  await crawlAuctionet(
    {
      ...options,
      orders: [...options.orders, "estimate_asc", "estimate_desc"],
    },
    result,
  );
  expect(result.discovered_item_count).toBe(3);
  expect(catalogObjectExists).toHaveBeenCalledTimes(3);
  expect(putCatalogObject).not.toHaveBeenCalled();
  expect(fetchAuctionetHtml).toHaveBeenCalledTimes(3);
  expect(console.log).toHaveBeenCalledWith(
    expect.stringContaining("Advertised coverage reached (3/3)"),
  );
});

it("skips remaining sorts when the first pass covers the advertised count", async () => {
  vi.mocked(fetchAuctionetHtml).mockResolvedValueOnce(page([10001, 10002], 2));
  await crawlAuctionet(options, stats());
  expect(fetchAuctionetHtml).toHaveBeenCalledTimes(1);
  expect(console.log).toHaveBeenCalledWith(
    expect.stringContaining("stopped (no valid next link)"),
  );
  expect(console.log).toHaveBeenCalledWith(
    expect.stringContaining("2/2 unique items discovered across orders"),
  );
});

it("fails visibly if capped orders leave a gap", async () => {
  vi.mocked(fetchAuctionetHtml).mockResolvedValue(page([10001], 3));
  await expect(crawlAuctionet(options, stats())).rejects.toThrow(
    "Incomplete archive",
  );
  expect(fetchAuctionetHtml).toHaveBeenCalledTimes(2);
});

it("does not skip remaining sorts when the advertised count is unknown", async () => {
  vi.mocked(fetchAuctionetHtml).mockResolvedValue(
    '<a href="/en/10001-lot">Lot</a>',
  );
  await expect(crawlAuctionet(options, stats())).rejects.toThrow(
    "of unknown advertised lots",
  );
  expect(fetchAuctionetHtml).toHaveBeenCalledTimes(2);
});

it("discovers catalogue lots whose listing URL has no Auctionet id", async () => {
  vi.mocked(fetchAuctionetHtml).mockResolvedValue(
    page([10001], 2) +
      '<div data-props="{&quot;items&quot;:[{&quot;id&quot;:1442234,&quot;shortTitle&quot;:&quot;CHANDELIER&quot;,&quot;url&quot;:&quot;/en/events/272-hostkvalite-2020/16-chandelier&quot;}]}"></div>',
  );
  const result = stats();
  await crawlAuctionet({ ...options, orders: ["end_desc"] }, result);
  expect(result.discovered_item_count).toBe(2);
  expect(catalogObjectExists).toHaveBeenCalledWith(
    expect.stringContaining("1442234"),
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

it.each([1, 3, 5])(
  "saves exactly %i new items with concurrent workers",
  async (maxItems) => {
    vi.mocked(catalogObjectExists).mockResolvedValue(false);
    vi.mocked(fetchAuctionetHtml).mockImplementation(async (url) => {
      if (url.pathname !== options.url.pathname)
        return "<h1>Historical lot</h1>";
      const number = Number(url.searchParams.get("page") ?? "1");
      const firstId = 10001 + (number - 1) * 2;
      return (
        page([firstId, firstId + 1], 30) +
        `<a rel="next" href="?company_id=232&is=ended&order=end_desc&page=${number + 1}">Next</a>`
      );
    });
    const result = stats();
    await crawlAuctionet(
      { ...options, orders: ["end_desc"], concurrency: 3, maxItems },
      result,
    );
    expect(result.saved_item_count).toBe(maxItems);
    expect(result.skipped_item_count).toBe(0);
    expect(putCatalogObject).toHaveBeenCalledTimes(maxItems);
    expect(catalogObjectExists).toHaveBeenCalledTimes(maxItems);
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining(
        `stopped (item budget (--max-items ${maxItems}))`,
      ),
    );
  },
);

it("frees budget slots after skips and failures", async () => {
  vi.mocked(catalogObjectExists).mockImplementation(async (key) =>
    /10001|10004/.test(key),
  );
  vi.mocked(fetchAuctionetHtml).mockImplementation(async (url) => {
    if (url.pathname === options.url.pathname) {
      return page([10001, 10002, 10003, 10004, 10005, 10006], 30);
    }
    if (url.pathname.includes("10002")) throw new Error("Item fetch failed");
    return "<h1>Historical lot</h1>";
  });
  const result = stats();
  await crawlAuctionet({ ...options, concurrency: 3, maxItems: 2 }, result);
  expect(result.saved_item_count).toBe(2);
  expect(result.skipped_item_count).toBe(2);
  expect(result.failures).toHaveLength(1);
  expect(putCatalogObject).toHaveBeenCalledTimes(2);
});

it("reports the page budget for each sort while allowing partial coverage", async () => {
  vi.mocked(fetchAuctionetHtml).mockImplementation(async (url) => {
    const order = url.searchParams.get("order");
    return (
      page([order === "end_asc_archive" ? 10001 : 10002], 3) +
      `<a rel="next" href="?company_id=232&is=ended&order=${order}&page=2">Next</a>`
    );
  });
  const result = stats();
  await crawlAuctionet({ ...options, maxPages: 1 }, result);
  expect(result.discovered_item_count).toBe(2);
  expect(fetchAuctionetHtml).toHaveBeenCalledTimes(2);
  for (const order of options.orders) {
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining(
        `Order ${order}: stopped (page budget (--max-pages 1))`,
      ),
    );
  }
});

it("reports an incremental stop after a page of stored items", async () => {
  vi.mocked(fetchAuctionetHtml).mockResolvedValueOnce(page([10001], 3, true));
  await crawlAuctionet(
    { ...options, orders: ["end_desc"], incremental: true },
    stats(),
  );
  expect(fetchAuctionetHtml).toHaveBeenCalledTimes(1);
  expect(console.log).toHaveBeenCalledWith(
    expect.stringContaining(
      "stopped (all page items already in bucket (incremental stop))",
    ),
  );
});
