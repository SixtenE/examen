import { describe, expect, it } from "vitest";
import {
  isAuctionetCatalogId,
  isAuctionetImageUrl,
  sanitizeMatchPayload,
} from "@/lib/auctionet";

describe("sanitizeMatchPayload", () => {
  it("keeps Auctionet catalog hits", () => {
    expect(
      sanitizeMatchPayload({
        auctionet_id: "12345",
        image_url: "https://images.auctionet.com/uploads/item_12345_0.jpg",
        title: "Clock",
        price: 100,
        currency: "SEK",
      }),
    ).toEqual({
      auctionet_id: "12345",
      image_url: "https://images.auctionet.com/uploads/item_12345_0.jpg",
      title: "Clock",
      price: 100,
      currency: "SEK",
    });
  });

  it("rejects open redirects, javascript URLs, and off-host images", () => {
    expect(isAuctionetCatalogId("12345")).toBe(true);
    expect(isAuctionetCatalogId("@evil.example")).toBe(false);
    expect(isAuctionetCatalogId("https://evil.example")).toBe(false);

    expect(
      isAuctionetImageUrl("https://images.auctionet.com/uploads/item_1_0.jpg"),
    ).toBe(true);
    expect(isAuctionetImageUrl("javascript:alert(1)")).toBe(false);
    expect(
      isAuctionetImageUrl("https://evil.example/uploads/item_1_0.jpg"),
    ).toBe(false);
    expect(
      isAuctionetImageUrl(
        "https://user:pass@images.auctionet.com/uploads/item_1_0.jpg",
      ),
    ).toBe(false);

    expect(
      sanitizeMatchPayload({
        auctionet_id: "12345",
        image_url: "https://169.254.169.254/latest/meta-data/",
      }),
    ).toBeNull();
  });
});
