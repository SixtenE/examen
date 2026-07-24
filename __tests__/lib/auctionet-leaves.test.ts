import { describe, expect, it } from "vitest";
import {
  extractCategoryFacets,
  extractEndedItemCount,
  listingOrdersForSegment,
  withListingOrder,
} from "@/lib/auctionet-leaves";

const FACET_HTML = `
<nav class="menu-box">
  <ul class="menu-box__items">
    <li class="menu-box__item menu-box__item--all">
      <a class="menu-box__link" href="/en/search?company_id=232&amp;is=ended">
        <span class="menu-box__link__text">Any category</span>
        <span class="menu-box__link__count">(80,210)</span>
      </a>
    </li>
    <li class="menu-box__item is-active">
      <a class="menu-box__link" href="/en/search/25-art?company_id=232&amp;is=ended">
        <span class="menu-box__link__text">Art</span>
        <span class="menu-box__link__count">(24,148)</span>
      </a>
      <ul class="menu-box__children">
        <li class="menu-box__item">
          <a class="menu-box__link" href="/en/search/28-paintings?company_id=232&amp;is=ended">
            <span class="menu-box__link__text">Paintings</span>
            <span class="menu-box__link__count">(12,527)</span>
          </a>
        </li>
        <li class="menu-box__item">
          <a class="menu-box__link" href="/en/search/119-drawings?company_id=232&amp;is=ended">
            <span class="menu-box__link__text">Drawings</span>
            <span class="menu-box__link__count">(361)</span>
          </a>
        </li>
      </ul>
    </li>
    <li class="menu-box__item">
      <a class="menu-box__link" href="/en/search/9-ceramics-porcelain?company_id=232&amp;is=ended">
        <span class="menu-box__link__text">Ceramics &amp; Porcelain</span>
        <span class="menu-box__link__count">(7,782)</span>
      </a>
    </li>
    <li class="menu-box__item">
      <a class="menu-box__link" href="/en/search/25-art?company_id=1&amp;is=ended">
        <span class="menu-box__link__text">Other house</span>
        <span class="menu-box__link__count">(32,944)</span>
      </a>
    </li>
  </ul>
</nav>
<span class="tabs__show-on-small-displays">(24 148)</span>
`;

describe("auctionet-leaves", () => {
  it("extracts category facets with counts and company ids", () => {
    const facets = extractCategoryFacets(
      FACET_HTML,
      new URL("https://auctionet.com/en/search?company_id=232&is=ended"),
    );

    expect(facets.map((facet) => facet.segment)).toEqual([
      "25-art",
      "28-paintings",
      "119-drawings",
      "9-ceramics-porcelain",
      "25-art",
    ]);
    expect(facets[0]).toMatchObject({
      segment: "25-art",
      count: 24148,
      companyId: 232,
    });
    expect(facets[1]).toMatchObject({
      segment: "28-paintings",
      count: 12527,
      companyId: 232,
    });
    expect(facets.at(-1)?.companyId).toBe(1);
  });

  it("reads ended-item facet count from tabs", () => {
    expect(extractEndedItemCount(FACET_HTML)).toBe(24148);
  });

  it("uses multi-order only for oversized paintings", () => {
    expect(listingOrdersForSegment("28-paintings")).toEqual([
      "end_asc_archive",
      "end_desc",
      "estimate_asc",
      "estimate_desc",
    ]);
    expect(listingOrdersForSegment("9-ceramics-porcelain")).toEqual([
      "sold_recent",
    ]);
  });

  it("applies listing order and clears page", () => {
    const url = withListingOrder(
      "https://auctionet.com/en/search/28-paintings?is=ended&company_id=232&page=3",
      "end_desc",
    );
    expect(url.searchParams.get("order")).toBe("end_desc");
    expect(url.searchParams.get("page")).toBeNull();
  });
});
