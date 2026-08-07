import { describe, expect, it } from "vitest";
import {
  assertCategorySegment,
  AUCTIONET_LEAF_CATEGORIES,
  bucketKeyToLocalPath,
  categoryBucketPrefix,
  categoryItemsDir,
  categorySegmentFromSearchUrl,
  categoryVectorsDir,
  expectedPointIds,
  getPointId,
  itemBucketKey,
  localPathToBucketKey,
  parseCatalogCategories,
  parsePipelineStages,
  PIPELINE_STAGES,
  REFERENCE_COLLECTIONS,
  referenceCollection,
} from "@/lib/catalog-paths";

describe("catalog-paths", () => {
  it("validates category segments", () => {
    expect(assertCategorySegment("9-ceramics-porcelain")).toBe(
      "9-ceramics-porcelain",
    );
    expect(() => assertCategorySegment("ceramics")).toThrow(/Invalid/);
  });

  it("builds local and bucket paths for a category", () => {
    expect(categoryItemsDir("28-paintings")).toBe(
      "data/auctionet/items/28-paintings",
    );
    expect(categoryVectorsDir("28-paintings")).toBe(
      "data/auctionet/items/28-paintings/vectors",
    );
    expect(categoryBucketPrefix("28-paintings")).toBe(
      "scrape/28-paintings",
    );
  });

  it("derives category segment from search URL", () => {
    expect(
      categorySegmentFromSearchUrl(
        "https://auctionet.com/en/search/9-ceramics-porcelain?is=ended",
      ),
    ).toBe("9-ceramics-porcelain");
    expect(() =>
      categorySegmentFromSearchUrl("https://auctionet.com/en/items/1"),
    ).toThrow(/missing a category segment/);
  });

  it("builds item bucket keys", () => {
    expect(itemBucketKey("9-ceramics-porcelain", 123456)).toBe(
      "scrape/9-ceramics-porcelain/123/123456.json",
    );
  });

  it("round-trips local paths and bucket keys", () => {
    const localPath =
      "data/auctionet/items/9-ceramics-porcelain/123/123456.json";
    const key = localPathToBucketKey(localPath);

    expect(key).toBe(
      "scrape/9-ceramics-porcelain/123/123456.json",
    );
    expect(bucketKeyToLocalPath(key)).toBe(localPath);
  });

  it("rejects paths outside the catalog root", () => {
    expect(() => localPathToBucketKey("tmp/outside.json")).toThrow(/outside/);
    expect(() =>
      bucketKeyToLocalPath("uploads/query-key.jpg"),
    ).toThrow(/outside/);
  });

  it("derives deterministic Qdrant point IDs", () => {
    expect(getPointId(123456, 2)).toBe(12345602);
    expect(expectedPointIds(10, 3)).toEqual([1000, 1001, 1002]);
  });

  it("parses CATALOG_CATEGORIES overrides", () => {
    expect(parseCatalogCategories("28-paintings")).toEqual([
      {
        segment: "28-paintings",
        url: "https://auctionet.com/en/search/28-paintings?is=ended&company_id=232",
      },
    ]);

    expect(
      parseCatalogCategories(
        "9-ceramics-porcelain|https://auctionet.com/en/search/9-ceramics-porcelain?is=ended&sort=new",
      ),
    ).toEqual([
      {
        segment: "9-ceramics-porcelain",
        url: "https://auctionet.com/en/search/9-ceramics-porcelain?is=ended&sort=new",
      },
    ]);
  });

  it("defaults to the Auctionet leaf taxonomy with company 232 URLs", () => {
    const categories = parseCatalogCategories(undefined);
    expect(categories).toHaveLength(AUCTIONET_LEAF_CATEGORIES.length);
    expect(AUCTIONET_LEAF_CATEGORIES).toHaveLength(39);
    expect(categories.some((category) => category.segment === "28-paintings")).toBe(
      true,
    );
    expect(categories.some((category) => category.segment === "59-licence-weapons")).toBe(
      true,
    );
    expect(
      categories.some((category) => category.segment === "170-wine-port-spirits"),
    ).toBe(true);
    expect(
      categories.find((category) => category.segment === "28-paintings")?.url,
    ).toContain("company_id=232");
    expect(categories.some((category) => category.segment === "25-art")).toBe(
      false,
    );
    expect(
      categories.some((category) => category.segment === "16-furniture"),
    ).toBe(false);
  });

  it("derives Qdrant collection names from category segments", () => {
    expect(referenceCollection("9-ceramics-porcelain")).toBe(
      "references-9-ceramics-porcelain",
    );
    expect(REFERENCE_COLLECTIONS).toHaveLength(AUCTIONET_LEAF_CATEGORIES.length);
    expect(REFERENCE_COLLECTIONS).toContain("references-28-paintings");
    expect(REFERENCE_COLLECTIONS).toContain("references-9-ceramics-porcelain");
    expect(REFERENCE_COLLECTIONS).not.toContain("references");
  });

  it("parses pipeline stages", () => {
    expect([...parsePipelineStages(undefined)]).toEqual([...PIPELINE_STAGES]);
    expect([...parsePipelineStages("")]).toEqual([...PIPELINE_STAGES]);
    expect([...parsePipelineStages("scrape,upsert")]).toEqual(["scrape", "upsert"]);
    expect(() => parsePipelineStages("scrape,upload")).toThrow(/Unknown pipeline stage/);
  });
});
