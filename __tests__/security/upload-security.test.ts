import { afterEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

const QUERY_ID = "550e8400-e29b-41d4-a716-446655440000";
const ATTACKER_OWNER_COOKIE = "'; DROP TABLE queries;--";
const NANOID_PATTERN = /^[A-Za-z0-9_-]{21}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const mockS3Send = vi.hoisted(() => vi.fn().mockResolvedValue({}));
const mockInsertReturning = vi.hoisted(() =>
  vi
    .fn()
    .mockResolvedValue([{ id: "550e8400-e29b-41d4-a716-446655440000" }]),
);
const mockInsertValues = vi.hoisted(() =>
  vi.fn((values: unknown) => {
    void values;
    return { returning: mockInsertReturning };
  }),
);
const mockEnforceRateLimit = vi.hoisted(() => vi.fn().mockResolvedValue(null));
const mockSharpToBuffer = vi.hoisted(() =>
  vi.fn().mockResolvedValue(Buffer.from("processed-jpeg")),
);
const mockSharpJpeg = vi.hoisted(() => vi.fn());
const mockSharpResize = vi.hoisted(() => vi.fn());
const mockSharp = vi.hoisted(() => {
  const chain = {
    rotate: vi.fn(),
    resize: mockSharpResize,
    jpeg: mockSharpJpeg,
    toBuffer: mockSharpToBuffer,
  };
  chain.rotate.mockReturnValue(chain);
  mockSharpResize.mockReturnValue(chain);
  mockSharpJpeg.mockReturnValue(chain);
  return vi.fn(() => chain);
});
const mockHeicConvert = vi.hoisted(() => vi.fn());

vi.mock("sharp", () => ({ default: mockSharp }));
vi.mock("heic-convert", () => ({ default: mockHeicConvert }));

vi.mock("@/lib/s3", () => ({
  s3Client: { send: (...args: unknown[]) => mockS3Send(...args) },
}));

vi.mock("@/db", () => ({
  db: {
    insert: vi.fn(() => ({
      values: mockInsertValues,
    })),
  },
}));

vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: (...args: unknown[]) => mockEnforceRateLimit(...args),
}));

import { POST } from "@/app/api/upload/route";

function pngBytes() {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}

function makeRequest(options: {
  file?: File | null;
  files?: File[];
  contentLength?: string | null;
  cookie?: string;
  extraFields?: Record<string, string>;
}) {
  const {
    file = null,
    files,
    contentLength,
    cookie,
    extraFields = {},
  } = options;
  const headers = new Headers();
  if (contentLength !== null) {
    headers.set(
      "content-length",
      contentLength ?? String((file?.size ?? 0) + 512),
    );
  }
  if (cookie) {
    headers.set("cookie", cookie);
  }

  const formData = vi.fn(async () => {
    const data = new FormData();
    for (const f of files ?? (file ? [file] : [])) {
      data.append("file", f);
    }
    for (const [name, value] of Object.entries(extraFields)) {
      data.append(name, value);
    }
    return data;
  });

  return {
    headers,
    formData,
  } as unknown as NextRequest & { formData: typeof formData };
}

afterEach(() => {
  vi.clearAllMocks();
  mockEnforceRateLimit.mockResolvedValue(null);
  mockSharpToBuffer.mockResolvedValue(Buffer.from("processed-jpeg"));
  mockInsertReturning.mockResolvedValue([{ id: QUERY_ID }]);
});

describe("upload: content-length gate", () => {
  it("rejects oversized requests before reading the body", async () => {
    const request = makeRequest({
      contentLength: String(17 * 1024 * 1024),
    });

    const response = await POST(request);

    expect(response.status).toBe(413);
    expect(request.formData).not.toHaveBeenCalled();
    expect(mockS3Send).not.toHaveBeenCalled();
  });

  it.each(["-1", "not-a-number", "1e999", "0.5"])(
    "rejects malformed Content-Length %j",
    async (contentLength) => {
      const response = await POST(makeRequest({ contentLength }));

      expect([400, 411, 413]).toContain(response.status);
      expect(mockS3Send).not.toHaveBeenCalled();
    },
  );

  it("requires Content-Length to prevent chunked-encoding bypass", async () => {
    const response = await POST(makeRequest({ contentLength: null }));

    expect(response.status).toBe(411);
    expect(mockS3Send).not.toHaveBeenCalled();
  });
});

describe("upload: malicious file content", () => {
  it("rejects an executable masquerading as an image via MIME spoofing", async () => {
    // PE/DOS header bytes, but the client claims image/png.
    const file = new File(
      [new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00])],
      "payload.png",
      { type: "image/png" },
    );
    mockSharpToBuffer.mockRejectedValueOnce(
      new Error("Input buffer contains unsupported image format"),
    );

    const response = await POST(makeRequest({ file }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Unsupported or corrupt image");
    expect(mockS3Send).not.toHaveBeenCalled();
    expect(mockInsertValues).not.toHaveBeenCalled();
  });

  it("rejects an HTML polyglot served with an image MIME type", async () => {
    const file = new File(
      ['<html><script>alert(document.cookie)</script></html>'],
      "polyglot.png",
      { type: "image/png" },
    );
    mockSharpToBuffer.mockRejectedValueOnce(
      new Error("Input buffer contains unsupported image format"),
    );

    const response = await POST(makeRequest({ file }));

    expect(response.status).toBe(400);
    expect(mockS3Send).not.toHaveBeenCalled();
  });

  it("rejects SVG uploads (scriptable markup is not in the allowlist)", async () => {
    const file = new File(
      ['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'],
      "vector.svg",
      { type: "image/svg+xml" },
    );

    const response = await POST(makeRequest({ file }));

    expect(response.status).toBe(400);
    expect(mockSharp).not.toHaveBeenCalled();
    expect(mockS3Send).not.toHaveBeenCalled();
  });

  it("rejects image formats outside the decoder allowlist", async () => {
    const file = new File([new Uint8Array([0x47, 0x49, 0x46, 0x38])], "a.gif", {
      type: "image/gif",
    });

    const response = await POST(makeRequest({ file }));

    expect(response.status).toBe(400);
    expect(mockSharp).not.toHaveBeenCalled();
  });

  it("rejects a fake .heic file whose bytes fail decoding", async () => {
    const file = new File(["not really heic"], "photo.heic", { type: "" });
    mockHeicConvert.mockRejectedValueOnce(new Error("invalid heic bitstream"));

    const response = await POST(makeRequest({ file }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Unsupported or corrupt image");
    expect(mockS3Send).not.toHaveBeenCalled();
  });

  it("rejects a non-File value in the file field (type confusion)", async () => {
    const request = makeRequest({
      contentLength: "128",
      extraFields: { file: "just-a-string" },
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(mockS3Send).not.toHaveBeenCalled();
  });
});

describe("upload: decoder hardening", () => {
  it("passes a pixel ceiling to sharp to stop decompression bombs", async () => {
    const file = new File([pngBytes()], "bomb.png", { type: "image/png" });

    const response = await POST(makeRequest({ file }));

    expect(response.status).toBe(200);
    expect(mockSharp).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.objectContaining({ limitInputPixels: 64_000_000 }),
    );
  });

  it("re-encodes every upload to JPEG so stored bytes cannot be content-sniffed", async () => {
    const file = new File([pngBytes()], "photo.png", { type: "image/png" });

    const response = await POST(makeRequest({ file }));

    expect(response.status).toBe(200);
    expect(mockSharpJpeg).toHaveBeenCalledWith({ quality: 80 });
    const putCommand = mockS3Send.mock.calls[0][0] as PutObjectCommand;
    expect(putCommand).toBeInstanceOf(PutObjectCommand);
    expect(putCommand.input.ContentType).toBe("image/jpeg");
    expect(putCommand.input.Body).toEqual(Buffer.from("processed-jpeg"));
  });
});

describe("upload: storage key and field injection", () => {
  it("ignores the client filename for the storage key (no path traversal)", async () => {
    const file = new File([pngBytes()], "../../../../etc/passwd.png", {
      type: "image/png",
    });

    const response = await POST(makeRequest({ file }));

    expect(response.status).toBe(200);
    const putCommand = mockS3Send.mock.calls[0][0] as PutObjectCommand;
    expect(putCommand.input.Key).toMatch(NANOID_PATTERN);
    expect(putCommand.input.Key).not.toContain("..");
    expect(putCommand.input.Key).not.toContain("/");
  });

  it("ignores extra form fields attempting mass assignment", async () => {
    const file = new File([pngBytes()], "photo.png", { type: "image/png" });

    const response = await POST(
      makeRequest({
        file,
        extraFields: {
          id: "11111111-2222-3333-4444-555555555555",
          owner_id: "11111111-2222-3333-4444-555555555555",
          image_key: "scrape/attacker-controlled",
          title: "attacker title",
          status: "ready",
        },
      }),
    );

    expect(response.status).toBe(200);
    const values = mockInsertValues.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(values).sort()).toEqual([
      "image_key",
      "owner_id",
      "title",
    ]);
    expect(values.owner_id).toMatch(UUID_PATTERN);
    expect(values.owner_id).not.toBe("11111111-2222-3333-4444-555555555555");
    expect(values.image_key).toMatch(NANOID_PATTERN);
    expect(values.image_key).not.toBe("scrape/attacker-controlled");
    const putCommand = mockS3Send.mock.calls[0][0] as PutObjectCommand;
    expect(putCommand.input.Key).toBe(values.image_key);
  });

  it("stores only the first file when multiple are submitted", async () => {
    const request = makeRequest({
      contentLength: "1024",
      files: [
        new File([pngBytes()], "first.png", { type: "image/png" }),
        new File([pngBytes()], "second.png", { type: "image/png" }),
      ],
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mockS3Send).toHaveBeenCalledTimes(1);
    expect(mockInsertValues).toHaveBeenCalledTimes(1);
  });

  it("never uses an attacker-supplied owner cookie that is not a UUID", async () => {
    const file = new File([pngBytes()], "photo.png", { type: "image/png" });

    const response = await POST(
      makeRequest({ file, cookie: `examen-owner=${ATTACKER_OWNER_COOKIE}` }),
    );

    expect(response.status).toBe(200);
    const values = mockInsertValues.mock.calls[0][0] as Record<string, unknown>;
    expect(values.owner_id).toMatch(UUID_PATTERN);
    expect(values.owner_id).not.toBe(ATTACKER_OWNER_COOKIE);
  });
});

describe("upload: failure handling", () => {
  it("returns a generic error without leaking storage internals", async () => {
    mockS3Send.mockRejectedValueOnce(
      new Error("SignatureDoesNotMatch: AKIAIOSFODNN7EXAMPLE"),
    );
    const file = new File([pngBytes()], "photo.png", { type: "image/png" });

    const response = await POST(makeRequest({ file }));
    const raw = await response.text();

    expect(response.status).toBe(500);
    expect(JSON.parse(raw)).toEqual({ error: "Upload failed" });
    expect(raw).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(raw).not.toContain("SignatureDoesNotMatch");
  });

  it("issues a compensating delete when the database insert fails", async () => {
    mockInsertReturning.mockRejectedValueOnce(
      new Error("db connection string postgres://user:secret@host"),
    );
    const file = new File([pngBytes()], "photo.png", { type: "image/png" });

    const response = await POST(makeRequest({ file }));
    const raw = await response.text();

    expect(response.status).toBe(500);
    expect(raw).not.toContain("postgres://");
    expect(mockS3Send).toHaveBeenCalledTimes(2);
    const cleanup = mockS3Send.mock.calls[1][0] as DeleteObjectCommand;
    expect(cleanup).toBeInstanceOf(DeleteObjectCommand);
    const putCommand = mockS3Send.mock.calls[0][0] as PutObjectCommand;
    expect(cleanup.input.Key).toBe(putCommand.input.Key);
  });

  it("fails closed on rate limiting before any request processing", async () => {
    mockEnforceRateLimit.mockResolvedValueOnce(
      Response.json(
        { error: "Service temporarily unavailable" },
        { status: 503 },
      ),
    );
    const request = makeRequest({ contentLength: "1024" });

    const response = await POST(request);

    expect(response.status).toBe(503);
    expect(mockEnforceRateLimit).toHaveBeenCalledWith(
      request,
      expect.objectContaining({ scope: "api:upload:post", failClosed: true }),
    );
    expect(request.formData).not.toHaveBeenCalled();
    expect(mockS3Send).not.toHaveBeenCalled();
  });
});
