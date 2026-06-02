import { NextRequest, NextResponse } from "next/server";

type AuctionetImage = {
  auctionet_id: number;
  image_url: string;
};

const AUCTIONET_HOSTS = new Set(["auctionet.com", "www.auctionet.com"]);
const USER_AGENT =
  "Mozilla/5.0 (compatible; ExamenAuctionetScraper/1.0; +https://auctionet.com)";

function parseAuctionetUrl(value: unknown) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("Missing required field 'url'");
  }

  const rawUrl = value.trim();
  const url = new URL(
    rawUrl.startsWith("http://") || rawUrl.startsWith("https://")
      ? rawUrl
      : `https://${rawUrl}`,
  );

  if (!AUCTIONET_HOSTS.has(url.hostname)) {
    throw new Error("URL must be an Auctionet link");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("URL must use http or https");
  }

  const idMatch = url.pathname.match(/^\/(?:[a-z]{2}\/)?(\d+)(?:[-/]|$)/i);
  if (!idMatch) {
    throw new Error("Could not find Auctionet id in URL");
  }

  return { auctionetId: Number(idMatch[1]), url };
}

function decodeHtmlAttribute(value: string) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function getAttributeValues(html: string, attribute: string) {
  const values: string[] = [];
  const pattern = new RegExp(`\\b${attribute}\\s*=\\s*(["'])(.*?)\\1`, "gi");

  for (const match of html.matchAll(pattern)) {
    values.push(decodeHtmlAttribute(match[2]));
  }

  return values;
}

function extractAuctionetImages(
  html: string,
  auctionetId: number,
): AuctionetImage[] {
  const itemImagePattern = new RegExp(
    `^https://images\\.auctionet\\.com/uploads/[^"']*item_${auctionetId}_[^"']+\\.(?:jpg|jpeg|png|webp)$`,
    "i",
  );

  const imageUrls = [
    ...getAttributeValues(html, "data-pin-media"),
    ...getAttributeValues(html, "src"),
  ];

  const uniqueUrls = new Set(
    imageUrls.filter((imageUrl) => itemImagePattern.test(imageUrl)),
  );

  return Array.from(uniqueUrls, (imageUrl) => ({
    auctionet_id: auctionetId,
    image_url: imageUrl,
  }));
}

export async function POST(request: NextRequest) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    let parsed: ReturnType<typeof parseAuctionetUrl>;
    try {
      const url =
        typeof body === "object" && body !== null && !Array.isArray(body)
          ? (body as { url?: unknown }).url
          : undefined;

      parsed = parseAuctionetUrl(url);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Invalid URL" },
        { status: 400 },
      );
    }

    const response = await fetch(parsed.url, {
      headers: {
        Accept: "text/html",
        "User-Agent": USER_AGENT,
      },
      cache: "no-store",
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: "Failed to fetch Auctionet page" },
        { status: response.status },
      );
    }

    const html = await response.text();
    return NextResponse.json(
      extractAuctionetImages(html, parsed.auctionetId),
    );
  } catch (error) {
    console.error("scrape route error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
