import { afterEach, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import QueryDetailPage from "../../app/[id]/page";
import Providers, { queryClient } from "../../components/providers";

const QUERY_ID = "550e8400-e29b-41d4-a716-446655440000";

const XSS_QUERY_TITLE = '<img src=x onerror=alert(document.cookie)>';
const XSS_MATCH_TITLE = '<script>alert("pwned")</script>';
const PROTOCOL_SMUGGLE_ID = "javascript:alert(1)";

const maliciousQuery = {
  id: QUERY_ID,
  title: XSS_QUERY_TITLE,
  image_key: "img-key",
  status: "ready" as const,
  createdAt: "2026-06-11T10:00:00.000Z",
  image_url: "https://signed.example/image.jpg",
};

const maliciousMatches = [
  {
    id: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
    query_id: QUERY_ID,
    auctionet_id: PROTOCOL_SMUGGLE_ID,
    image_url: "https://images.auctionet.com/match.jpg",
    title: XSS_MATCH_TITLE,
    price: 100,
    currency: "SEK",
    similarity_score: 42, // out-of-range score must not break the badge
    sold_at: "not-a-real-date", // garbage timestamps render as N/A
    createdAt: "2026-06-11T10:05:00.000Z",
  },
];

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: QUERY_ID }),
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
  redirect: vi.fn(),
}));

vi.mock("next/image", () => ({
  default: ({
    src,
    alt,
    ...props
  }: {
    src: string;
    alt: string;
    [key: string]: unknown;
  }) => <img src={src} alt={alt} {...props} />,
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

afterEach(() => {
  vi.clearAllMocks();
  queryClient.clear();
  vi.restoreAllMocks();
});

test("scraped and user-facing strings are escaped, links are origin-pinned", async () => {
  const fetchMock = vi.fn().mockImplementation((url: string) => {
    if (url === `/api/queries/${QUERY_ID}`) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => maliciousQuery,
      });
    }

    if (url === `/api/queries/${QUERY_ID}/matches`) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => maliciousMatches,
      });
    }

    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  });
  vi.stubGlobal("fetch", fetchMock);

  const { container } = render(
    <Providers>
      <QueryDetailPage />
    </Providers>,
  );

  // The malicious strings render as inert text, never as markup.
  expect(await screen.findByText(XSS_QUERY_TITLE)).toBeTruthy();
  expect(await screen.findByText(XSS_MATCH_TITLE)).toBeTruthy();
  expect(container.querySelector("script")).toBeNull();
  expect(container.querySelector('img[src="x"]')).toBeNull();
  expect(container.querySelector("[onerror]")).toBeNull();

  // A javascript: auctionet_id cannot smuggle a non-HTTPS href: the origin is
  // fixed by the template, so the payload becomes a harmless path segment.
  const link = container.querySelector("a[target='_blank']");
  expect(link).not.toBeNull();
  expect(link?.getAttribute("href")).toBe(
    `https://www.auctionet.com/${PROTOCOL_SMUGGLE_ID}`,
  );
  expect(link?.getAttribute("href")?.startsWith("https://")).toBe(true);

  // Out-of-range score is clamped to a sane percentage.
  expect(await screen.findByText("100% match")).toBeTruthy();

  // Garbage Sold At renders as N/A instead of throwing.
  expect(await screen.findByText("N/A")).toBeTruthy();
});
