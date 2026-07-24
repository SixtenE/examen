import { afterEach, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import QueryDetailPage from "../app/[id]/page";
import Providers, { queryClient } from "../components/providers";
import { toast } from "sonner";

const QUERY_ID = "550e8400-e29b-41d4-a716-446655440000";

const mockQuery = {
  id: QUERY_ID,
  title: "Golden Clock",
  image_key: "img-key",
  status: "ready" as const,
  createdAt: "2026-06-11T10:00:00.000Z",
  image_url: "https://signed.example/image.jpg",
};

const mockMatches = [
  {
    id: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
    query_id: QUERY_ID,
    auctionet_id: "12345",
    image_url: "https://example.com/match.jpg",
    title: "Antique clock",
    price: 500,
    currency: "SEK",
    similarity_score: 0.87,
    createdAt: "2026-06-11T10:05:00.000Z",
  },
];

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: QUERY_ID }),
  useRouter: () => ({
    push,
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

function renderPage() {
  return render(
    <Providers>
      <QueryDetailPage />
    </Providers>,
  );
}

afterEach(() => {
  vi.clearAllMocks();
  queryClient.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function matchesGetCallCount(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(
    ([url, init]) =>
      url === `/api/queries/${QUERY_ID}/matches` &&
      (init === undefined || init.method === undefined || init.method === "GET"),
  ).length;
}

function rateLimitedMatchesFetch() {
  return vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    if (url === `/api/queries/${QUERY_ID}`) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => mockQuery,
      });
    }

    if (url === `/api/queries/${QUERY_ID}/matches` && init?.method !== "POST") {
      return Promise.resolve({
        ok: false,
        status: 429,
        headers: new Headers({ "Retry-After": "10" }),
        json: async () => ({ error: "Too many requests" }),
      });
    }

    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  });
}

test("renders query title and matches", async () => {
  const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    if (url === `/api/queries/${QUERY_ID}`) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => mockQuery,
      });
    }

    if (url === `/api/queries/${QUERY_ID}/matches` && init?.method !== "POST") {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => mockMatches,
      });
    }

    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  });
  vi.stubGlobal("fetch", fetchMock);

  renderPage();

  expect(await screen.findByText("Golden Clock")).toBeTruthy();
  expect(await screen.findByText("Antique clock")).toBeTruthy();
  expect(await screen.findByText("500 SEK")).toBeTruthy();
  expect(await screen.findByText("87% match")).toBeTruthy();
});

test("starts match generation for pending queries", async () => {
  const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    if (url === `/api/queries/${QUERY_ID}`) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ ...mockQuery, status: "pending" }),
      });
    }

    if (url === `/api/queries/${QUERY_ID}/matches` && init?.method === "POST") {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => mockMatches,
      });
    }

    if (url === `/api/queries/${QUERY_ID}/matches`) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => [],
      });
    }

    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  });
  vi.stubGlobal("fetch", fetchMock);

  renderPage();

  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/queries/${QUERY_ID}/matches`,
      expect.objectContaining({ method: "POST" }),
    );
  });
});

test("shows a rate-limit toast when query detail is rate limited", async () => {
  const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    if (url === `/api/queries/${QUERY_ID}`) {
      return Promise.resolve({
        ok: false,
        status: 429,
        headers: new Headers({ "Retry-After": "15" }),
        json: async () => ({ error: "Too many requests" }),
      });
    }

    if (url === `/api/queries/${QUERY_ID}/matches` && init?.method !== "POST") {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => mockMatches,
      });
    }

    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  });
  vi.stubGlobal("fetch", fetchMock);

  renderPage();

  await waitFor(() => {
    expect(toast.error).toHaveBeenCalledWith(
      "Too many requests. Try again in 15 seconds.",
    );
  });
});

test("shows a rate-limit toast when match generation is rate limited", async () => {
  const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    if (url === `/api/queries/${QUERY_ID}`) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ ...mockQuery, status: "pending" }),
      });
    }

    if (url === `/api/queries/${QUERY_ID}/matches` && init?.method === "POST") {
      return Promise.resolve({
        ok: false,
        status: 429,
        headers: new Headers({ "Retry-After": "20" }),
        json: async () => ({ error: "Too many requests" }),
      });
    }

    if (url === `/api/queries/${QUERY_ID}/matches`) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => [],
      });
    }

    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  });
  vi.stubGlobal("fetch", fetchMock);

  renderPage();

  await waitFor(() => {
    expect(toast.error).toHaveBeenCalledWith(
      "Too many requests. Try again in 20 seconds.",
    );
  });
});

test("shows a rate-limit toast only once while matches poll is rate limited", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const fetchMock = rateLimitedMatchesFetch();
  vi.stubGlobal("fetch", fetchMock);

  renderPage();

  await waitFor(() => {
    expect(toast.error).toHaveBeenCalledWith(
      "Too many requests. Try again in 10 seconds.",
    );
  });
  expect(toast.error).toHaveBeenCalledTimes(1);

  const callsAfterToast = matchesGetCallCount(fetchMock);
  await vi.advanceTimersByTimeAsync(2000);

  expect(toast.error).toHaveBeenCalledTimes(1);
  expect(matchesGetCallCount(fetchMock)).toBe(callsAfterToast);
});

test("resumes matches poll after Retry-After when rate limited", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const fetchMock = rateLimitedMatchesFetch();
  vi.stubGlobal("fetch", fetchMock);

  renderPage();

  await waitFor(() => {
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  const callsAfterToast = matchesGetCallCount(fetchMock);
  await vi.advanceTimersByTimeAsync(10_000);

  await waitFor(() => {
    expect(matchesGetCallCount(fetchMock)).toBeGreaterThan(callsAfterToast);
  });
});
