import { afterEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const mockS3Send = vi.hoisted(() => vi.fn().mockResolvedValue({}));
const mockInsertReturning = vi.hoisted(() =>
  vi.fn().mockResolvedValue([{ id: "550e8400-e29b-41d4-a716-446655440000" }]),
);
const mockInsertValues = vi.hoisted(() =>
  vi.fn(() => ({ returning: mockInsertReturning })),
);
const mockEnforceRateLimit = vi.hoisted(() => vi.fn().mockResolvedValue(null));

vi.mock("sharp", () => {
  const chain = {
    rotate: vi.fn().mockReturnThis(),
    resize: vi.fn().mockReturnThis(),
    jpeg: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from("processed-jpeg")),
  };
  return { default: vi.fn(() => chain) };
});

vi.mock("heic-convert", () => ({
  default: vi.fn(),
}));

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

function makeUploadRequest(file: File | null, includeLength = true) {
  return {
    headers: new Headers(
      includeLength
        ? { "content-length": String((file?.size ?? 0) + 512) }
        : {},
    ),
    formData: async () => {
      const formData = new FormData();
      if (file) {
        formData.append("file", file);
      }
      return formData;
    },
  } as unknown as NextRequest;
}

afterEach(() => {
  vi.clearAllMocks();
  mockEnforceRateLimit.mockResolvedValue(null);
});

describe("POST /api/upload", () => {
  it("returns 429 when the request is rate limited", async () => {
    mockEnforceRateLimit.mockResolvedValueOnce(
      Response.json({ error: "Too many requests" }, { status: 429 }),
    );

    const response = await POST(makeUploadRequest(null));
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body.error).toBe("Too many requests");
    expect(mockS3Send).not.toHaveBeenCalled();
  });

  it("uploads a valid image and returns id and key", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "photo.png", {
      type: "image/png",
    });

    const response = await POST(makeUploadRequest(file));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.id).toBe("550e8400-e29b-41d4-a716-446655440000");
    expect(body.key).toBeUndefined();
    expect(response.headers.get("set-cookie")).toContain("examen-owner=");
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({ owner_id: expect.any(String) }),
    );
    expect(mockS3Send).toHaveBeenCalled();
  });

  it("returns 400 when no file is provided", async () => {
    const response = await POST(makeUploadRequest(null));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("No file provided in 'file' field");
  });

  it("returns 400 for empty files", async () => {
    const file = new File([], "empty.png", { type: "image/png" });
    const response = await POST(makeUploadRequest(file));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("File is empty");
  });

  it("returns 400 for non-image files", async () => {
    const file = new File(["text"], "notes.txt", { type: "text/plain" });
    const response = await POST(makeUploadRequest(file));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Unsupported image type");
  });

  it("rejects SVG uploads", async () => {
    const file = new File(["<svg/>"], "image.svg", {
      type: "image/svg+xml",
    });
    const response = await POST(makeUploadRequest(file));

    expect(response.status).toBe(400);
  });

  it("returns 413 for files over 15MB", async () => {
    const largeContent = new Uint8Array(15 * 1024 * 1024 + 1);
    const file = new File([largeContent], "big.png", { type: "image/png" });
    const response = await POST(makeUploadRequest(file));
    const body = await response.json();

    expect(response.status).toBe(413);
    expect(body.error).toBe("Request too large");
  });

  it("rejects requests without a content length before parsing", async () => {
    const response = await POST(makeUploadRequest(null, false));

    expect(response.status).toBe(411);
  });
});
