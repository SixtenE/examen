// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import sharp from "sharp";
import { embedAuctionetItem } from "../../scripts/embed";

const urls = [
  "https://images.auctionet.com/1.jpg",
  "https://images.auctionet.com/2.webp",
];
const item = { auctionet_id: 123, status: "sold", image_urls: urls };
const options = { delayMs: 0, maxRetries: 0 };
const invalidImage = () =>
  new Response(
    JSON.stringify({
      error: {
        message:
          'HTTP 400: {"error":{"message":"Provided image is not valid."}}',
        code: 400,
      },
    }),
    { status: 400 },
  );

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it.each(["jpeg", "png"] as const)(
  "preserves original %s bytes in the fallback",
  async (format) => {
    vi.stubEnv("OPENROUTER_API_KEY", "test");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const bytes = await sharp({
      create: {
        width: 17,
        height: 23,
        channels: 3,
        background: "red",
      },
    })
      .toFormat(format)
      .toBuffer();
    let requests = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === urls[0]) return new Response(new Uint8Array(bytes));
        if (++requests === 1) return invalidImage();
        expect(
          JSON.parse(init!.body as string).input[0].content[0].image_url.url,
        ).toBe(`data:image/${format};base64,${bytes.toString("base64")}`);
        return new Response(
          JSON.stringify({ data: [{ embedding: Array(3072).fill(0.1) }] }),
        );
      }),
    );
    await embedAuctionetItem({ ...item, image_urls: [urls[0]] }, options);
    expect(requests).toBe(2);
  },
);

it("recovers rejected URLs using full-resolution PNGs and keeps reference URLs and indices", async () => {
  vi.stubEnv("OPENROUTER_API_KEY", "test");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const image = await sharp({
    create: {
      width: 17,
      height: 23,
      channels: 3,
      background: "red",
    },
  })
    .webp()
    .toBuffer();
  let requests = 0;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (urls.includes(url)) return new Response(new Uint8Array(image));
    requests++;
    const inputs = JSON.parse(init!.body as string).input;
    if (requests === 1) {
      expect(
        inputs.map(
          (input: { content: { image_url: { url: string } }[] }) =>
            input.content[0].image_url.url,
        ),
      ).toEqual(urls);
      return invalidImage();
    }
    for (const input of inputs) {
      const dataUrl = input.content[0].image_url.url;
      expect(dataUrl).toMatch(/^data:image\/png;base64,/);
      expect(
        await sharp(Buffer.from(dataUrl.split(",")[1], "base64")).metadata(),
      ).toMatchObject({ format: "png", width: 17, height: 23 });
    }
    return new Response(
      JSON.stringify({
        data: urls.map((_, index) => ({ embedding: Array(3072).fill(index) })),
      }),
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  const artifact = await embedAuctionetItem(item, options);
  expect(requests).toBe(2);
  expect(
    artifact.references.map(({ image_index, image_url, embedding }) => ({
      image_index,
      image_url,
      value: embedding[0],
    })),
  ).toEqual(
    urls.map((image_url, image_index) => ({
      image_url,
      image_index,
      value: image_index,
    })),
  );
});

it("names a broken image and does not submit an incomplete batch", async () => {
  vi.stubEnv("OPENROUTER_API_KEY", "test");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const fetchMock = vi.fn(async (url: string) =>
    urls.includes(url) ? new Response("not an image") : invalidImage(),
  );
  vi.stubGlobal("fetch", fetchMock);
  await expect(
    embedAuctionetItem({ ...item, image_urls: [urls[0]] }, options),
  ).rejects.toThrow(urls[0]);
  expect(
    fetchMock.mock.calls.filter(([url]) => !urls.includes(url)),
  ).toHaveLength(1);
});

it.each(["invalid twice", "unrelated 400"])(
  "does not loop on %s",
  async (scenario) => {
    vi.stubEnv("OPENROUTER_API_KEY", "test");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const png = await sharp({
      create: { width: 1, height: 1, channels: 3, background: "red" },
    })
      .png()
      .toBuffer();
    let requests = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (urls.includes(url)) return new Response(new Uint8Array(png));
        requests++;
        return scenario === "invalid twice"
          ? invalidImage()
          : new Response(
              JSON.stringify({ error: { message: "Invalid dimensions" } }),
              { status: 400 },
            );
      }),
    );
    await expect(embedAuctionetItem(item, options)).rejects.toThrow(
      "OpenRouter embedding request failed (400)",
    );
    expect(requests).toBe(scenario === "invalid twice" ? 2 : 1);
  },
);

it("splits oversized inline bodies before sending and preserves every reference", async () => {
  vi.stubEnv("OPENROUTER_API_KEY", "test");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const png = await sharp({
    create: { width: 1, height: 1, channels: 3, background: "red" },
  })
    .png()
    .toBuffer();
  // Valid PNG with padding: exercise the real 50 MiB limit without a huge raster.
  const padded = Buffer.alloc(20 * 1024 * 1024);
  png.copy(padded);
  let requests = 0;
  const downloads: string[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (urls.includes(url)) {
      downloads.push(url);
      return new Response(new Uint8Array(padded));
    }
    expect(Buffer.byteLength(init!.body as string)).toBeLessThanOrEqual(
      50 * 1024 * 1024,
    );
    const input = JSON.parse(init!.body as string).input;
    if (++requests === 1) return invalidImage();
    expect(input).toHaveLength(1);
    expect(
      Buffer.from(
        input[0].content[0].image_url.url.split(",")[1],
        "base64",
      ).equals(padded),
    ).toBe(true);
    return new Response(
      JSON.stringify({ data: [{ embedding: Array(3072).fill(requests - 2) }] }),
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  const artifact = await embedAuctionetItem(item, options);
  expect(requests).toBe(3);
  expect(downloads).toEqual(urls);
  expect(
    artifact.references.map(({ image_url, image_index, embedding }) => ({
      image_url,
      image_index,
      value: embedding[0],
    })),
  ).toEqual(
    urls.map((image_url, image_index) => ({
      image_url,
      image_index,
      value: image_index,
    })),
  );
});

it("splits a provider 413 without downloading the images again", async () => {
  vi.stubEnv("OPENROUTER_API_KEY", "test");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const png = await sharp({
    create: { width: 1, height: 1, channels: 3, background: "red" },
  })
    .png()
    .toBuffer();
  const downloads: string[] = [];
  let requests = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (urls.includes(url)) {
        downloads.push(url);
        return new Response(new Uint8Array(png));
      }
      if (++requests === 1) return invalidImage();
      if (requests === 2)
        return new Response(
          JSON.stringify({ error: { message: "Request body too large" } }),
          { status: 413 },
        );
      expect(JSON.parse(init!.body as string).input).toHaveLength(1);
      return new Response(
        JSON.stringify({
          data: [{ embedding: Array(3072).fill(requests - 3) }],
        }),
      );
    }),
  );
  const artifact = await embedAuctionetItem(item, options);
  expect(artifact.references.map(({ embedding }) => embedding[0])).toEqual([
    0, 1,
  ]);
  expect(downloads).toEqual(urls);
  expect(requests).toBe(4);
});

it("reports a single image that cannot fit rather than submitting it or looping", async () => {
  vi.stubEnv("OPENROUTER_API_KEY", "test");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const png = await sharp({
    create: { width: 1, height: 1, channels: 3, background: "red" },
  })
    .png()
    .toBuffer();
  const padded = Buffer.alloc(38 * 1024 * 1024);
  png.copy(padded);
  let requests = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === urls[0]) return new Response(new Uint8Array(padded));
      requests++;
      return invalidImage();
    }),
  );
  await expect(
    embedAuctionetItem({ ...item, image_urls: [urls[0]] }, options),
  ).rejects.toThrow(
    `Embedding image exceeds the OpenRouter request size limit`,
  );
  expect(requests).toBe(1);
});
