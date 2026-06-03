export type AuctionetImage = {
  auctionet_id: number;
  image_url: string;
};

type AnchorElement = {
  href: URL;
  text: string;
  attributes: Record<string, string>;
};

export const AUCTIONET_USER_AGENT =
  "Mozilla/5.0 (compatible; ExamenAuctionetScraper/1.0; +https://auctionet.com)";

const AUCTIONET_HOSTS = new Set(["auctionet.com", "www.auctionet.com"]);

export function decodeHtmlAttribute(value: string) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

export function decodeHtmlText(value: string) {
  return decodeHtmlAttribute(value)
    .replaceAll("&nbsp;", " ")
    .replaceAll("&#160;", " ");
}

export function getAttributeValues(html: string, attribute: string) {
  const values: string[] = [];
  const pattern = new RegExp(`\\b${attribute}\\s*=\\s*(["'])(.*?)\\1`, "gi");

  for (const match of html.matchAll(pattern)) {
    values.push(decodeHtmlAttribute(match[2]));
  }

  return values;
}

export function getTagAttributes(tag: string) {
  const attributes: Record<string, string> = {};
  const pattern = /([\w:-]+)\s*=\s*(["'])(.*?)\2/gi;

  for (const match of tag.matchAll(pattern)) {
    attributes[match[1].toLowerCase()] = decodeHtmlAttribute(match[3]);
  }

  return attributes;
}

export function stripHtmlTags(value: string) {
  return decodeHtmlText(value.replaceAll(/<[^>]+>/g, " "))
    .replaceAll(/\s+/g, " ")
    .trim();
}

export function normalizeAuctionetUrl(value: unknown, fieldName = "url") {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing required field '${fieldName}'`);
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

  return url;
}

export function parseAuctionetUrl(value: unknown) {
  const url = normalizeAuctionetUrl(value);
  const auctionetId = getAuctionetIdFromPath(url.pathname);

  if (auctionetId === null) {
    throw new Error("Could not find Auctionet id in URL");
  }

  return { auctionetId, url };
}

export function getAuctionetIdFromPath(pathname: string) {
  const idMatch = pathname.match(/^\/(?:[a-z]{2}\/)?(\d+)(?:[-/]|$)/i);

  if (!idMatch) {
    return null;
  }

  return Number(idMatch[1]);
}

export function extractAuctionetImages(
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

export function extractAnchorElements(html: string, baseUrl: URL) {
  const anchors: AnchorElement[] = [];
  const pattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(pattern)) {
    const attributes = getTagAttributes(match[1]);
    const href = attributes.href;

    if (!href || href.startsWith("#") || href.startsWith("mailto:")) {
      continue;
    }

    try {
      const url = new URL(href, baseUrl);
      if (!AUCTIONET_HOSTS.has(url.hostname)) {
        continue;
      }

      anchors.push({
        href: url,
        text: stripHtmlTags(match[2]),
        attributes,
      });
    } catch {
      // Ignore malformed links; the crawler only needs well-formed Auctionet URLs.
    }
  }

  return anchors;
}

export function extractAuctionetItemUrls(html: string, baseUrl: URL) {
  const itemUrls = new Map<number, URL>();

  for (const anchor of extractAnchorElements(html, baseUrl)) {
    const auctionetId = getAuctionetIdFromPath(anchor.href.pathname);

    if (auctionetId !== null) {
      anchor.href.hash = "";
      itemUrls.set(auctionetId, anchor.href);
    }
  }

  const decodedHtml = decodeHtmlAttribute(html)
    .replaceAll("\\/", "/")
    .replaceAll("\\u002F", "/");
  const embeddedUrlPattern =
    /(?:https?:\/\/(?:www\.)?auctionet\.com)?\/(?:[a-z]{2}\/)?\d{5,}(?:[-/][^"'<>\s\\]*)?/gi;

  for (const match of decodedHtml.matchAll(embeddedUrlPattern)) {
    try {
      const url = new URL(match[0], baseUrl);
      const auctionetId = getAuctionetIdFromPath(url.pathname);

      if (auctionetId !== null) {
        url.hash = "";
        itemUrls.set(auctionetId, url);
      }
    } catch {
      // Ignore malformed embedded URLs.
    }
  }

  return Array.from(itemUrls.values());
}

export function extractNextListingPageUrl(html: string, currentUrl: URL) {
  const anchors = extractAnchorElements(html, currentUrl);

  const relNext = anchors.find((anchor) =>
    anchor.attributes.rel?.toLowerCase().split(/\s+/).includes("next"),
  );

  if (relNext) {
    relNext.href.hash = "";
    return relNext.href;
  }

  const textNext = anchors.find((anchor) => {
    const label = [
      anchor.text,
      anchor.attributes["aria-label"],
      anchor.attributes.title,
    ]
      .filter(Boolean)
      .join(" ");

    return /\b(next|nästa)\b/i.test(label);
  });

  if (textNext) {
    textNext.href.hash = "";
    return textNext.href;
  }

  const currentPage = Number(currentUrl.searchParams.get("page") ?? "1");
  const numericPageLinks = anchors
    .map((anchor) => {
      const page = Number(anchor.href.searchParams.get("page"));
      return Number.isInteger(page) && page > currentPage ? anchor.href : null;
    })
    .filter((url): url is URL => url !== null)
    .sort(
      (left, right) =>
        Number(left.searchParams.get("page")) -
        Number(right.searchParams.get("page")),
    );

  return numericPageLinks[0] ?? null;
}

export async function fetchAuctionetHtml(url: URL) {
  const response = await fetch(url, {
    headers: {
      Accept: "text/html",
      "User-Agent": AUCTIONET_USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch Auctionet page ${url.toString()}: ${response.status}`,
    );
  }

  return response.text();
}
