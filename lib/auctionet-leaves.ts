import { fetchAuctionetHtml } from "./auctionet";
import {
  categorySegmentFromSearchUrl,
  CRAFOORD_STOCKHOLM_COMPANY_ID,
  type CatalogCategory,
} from "./catalog-paths";

/** Auctionet listing hard-stop (~209 pages × 48 items). */
export const AUCTIONET_PAGE_ITEM_CAP = 10_000;

export { CRAFOORD_STOCKHOLM_COMPANY_ID };

/** Orders that together cover oversized leaves past the page cap. */
export const ARCHIVE_LISTING_ORDERS = [
  "end_asc_archive",
  "end_desc",
  "estimate_asc",
  "estimate_desc",
] as const;

export const INCREMENTAL_LISTING_ORDER = "sold_recent";

export type CategoryFacet = {
  segment: string;
  url: URL;
  label: string;
  count: number;
  companyId: number | null;
};

export function listingOrdersForSegment(segment: string): string[] {
  // Paintings for company 232 exceeds the page cap; multi-order fills the gap.
  if (segment === "28-paintings") {
    return [...ARCHIVE_LISTING_ORDERS];
  }

  return [INCREMENTAL_LISTING_ORDER];
}

export function withListingOrder(url: URL | string, order: string) {
  const next = new URL(typeof url === "string" ? url : url.toString());
  next.searchParams.set("order", order);
  next.searchParams.delete("page");
  next.hash = "";
  return next;
}

function parseCount(raw: string) {
  const digits = raw.replaceAll(/[^\d]/g, "");
  return digits.length > 0 ? Number(digits) : null;
}

/**
 * Category links from the search facet sidebar (`menu-box`), including nested children.
 * Skips "Any category" (no segment) and other auction-house rows (caller filters company).
 */
export function extractCategoryFacets(html: string, baseUrl: URL): CategoryFacet[] {
  const facets: CategoryFacet[] = [];
  const pattern =
    /href="(\/[^"]*\/search\/\d+-[a-z0-9-]+[^"]*)"[^>]*>\s*<span class="menu-box__link__text">([\s\S]*?)<\/span>\s*<span class="menu-box__link__count">\(([^)]+)\)<\/span>/gi;

  for (const match of html.matchAll(pattern)) {
    try {
      const url = new URL(match[1].replaceAll("&amp;", "&"), baseUrl);
      url.hash = "";
      const segment = categorySegmentFromSearchUrl(url);
      const companyRaw = url.searchParams.get("company_id");
      const companyId =
        companyRaw && /^\d+$/.test(companyRaw) ? Number(companyRaw) : null;
      const count = parseCount(match[3]);

      if (count === null) {
        continue;
      }

      facets.push({
        segment,
        url,
        label: match[2].replaceAll(/<[^>]+>/g, "").trim(),
        count,
        companyId,
      });
    } catch {
      // Ignore malformed facet links.
    }
  }

  return facets;
}

export function extractEndedItemCount(html: string) {
  const match = html.match(
    /tabs__show-on-small-displays">\(([\d\s\u00a0]+)\)/,
  );
  return match ? parseCount(match[1]) : null;
}

function uniqueBySegment(facets: CategoryFacet[]) {
  const seen = new Set<string>();
  const unique: CategoryFacet[] = [];

  for (const facet of facets) {
    if (seen.has(facet.segment)) {
      continue;
    }
    seen.add(facet.segment);
    unique.push(facet);
  }

  return unique;
}

function toCatalogCategory(facet: CategoryFacet): CatalogCategory {
  const url = new URL(facet.url.toString());
  url.searchParams.set("is", "ended");
  url.hash = "";
  return { segment: facet.segment, url: url.toString() };
}

/**
 * Walk Auctionet category facets for one company; expand parents over the page cap.
 */
export async function discoverCompanyLeafCategories(options: {
  companyId: number;
  pageItemCap?: number;
  delayMs?: number;
}): Promise<CatalogCategory[]> {
  const pageItemCap = options.pageItemCap ?? AUCTIONET_PAGE_ITEM_CAP;
  const delayMs = options.delayMs ?? 0;
  const rootUrl = new URL(
    `https://auctionet.com/en/search?is=ended&company_id=${options.companyId}`,
  );

  const rootHtml = await fetchAuctionetHtml(rootUrl);
  const topLevel = uniqueBySegment(
    extractCategoryFacets(rootHtml, rootUrl).filter(
      (facet) => facet.companyId === options.companyId,
    ),
  );

  const leaves: CatalogCategory[] = [];

  for (const facet of topLevel) {
    if (facet.count <= pageItemCap) {
      leaves.push(toCatalogCategory(facet));
      continue;
    }

    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    const childHtml = await fetchAuctionetHtml(facet.url);
    const children = uniqueBySegment(
      extractCategoryFacets(childHtml, facet.url).filter(
        (child) =>
          child.companyId === options.companyId &&
          child.segment !== facet.segment,
      ),
    );

    if (children.length === 0) {
      leaves.push(toCatalogCategory(facet));
      continue;
    }

    for (const child of children) {
      if (child.count <= pageItemCap) {
        leaves.push(toCatalogCategory(child));
        continue;
      }

      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      const grandHtml = await fetchAuctionetHtml(child.url);
      const grandchildren = uniqueBySegment(
        extractCategoryFacets(grandHtml, child.url).filter(
          (node) =>
            node.companyId === options.companyId &&
            node.segment !== child.segment,
        ),
      );

      if (grandchildren.length === 0) {
        leaves.push(toCatalogCategory(child));
      } else {
        for (const node of grandchildren) {
          leaves.push(toCatalogCategory(node));
        }
      }
    }
  }

  return leaves.sort((left, right) => left.segment.localeCompare(right.segment));
}
