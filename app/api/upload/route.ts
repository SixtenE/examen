import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import convert from "heic-convert";
import { nanoid } from "nanoid";
import { db } from "@/db";
import { queries } from "@/db/schema";
import { DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { s3Client } from "@/lib/s3";
import { enforceRateLimit } from "@/lib/rate-limit";
import {
  getOrCreateQueryOwnerId,
  setQueryOwnerCookie,
} from "@/lib/query-owner";

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15MB
const MAX_REQUEST_BYTES = MAX_UPLOAD_BYTES + 1024 * 1024;
const MAX_INPUT_PIXELS = 64_000_000;
const STORED_MAX_EDGE = 1500;
const STORED_JPEG_QUALITY = 80;
const ALLOWED_IMAGE_TYPES = new Set([
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const AUCTION_NOUNS = [
  "Gavel",
  "Hammer",
  "Paddle",
  "Lot",
  "Bidder",
  "Auctioneer",
  "Catalog",
  "Curio",
  "Relic",
  "Artifact",
  "Heirloom",
  "Collectible",
  "Vase",
  "Urn",
  "Brooch",
  "Locket",
  "Pocketwatch",
  "Clock",
  "Cabinet",
  "Mirror",
  "Frame",
  "Trunk",
  "Chest",
  "Ledger",
  "Manuscript",
  "Map",
  "Portrait",
  "Engraving",
  "Tapestry",
  "Goblet",
  "Decanter",
  "Candlestick",
  "Candelabra",
  "Medallion",
  "Seal",
  "Figurine",
  "Timepiece",
  "Sideboard",
  "Armoire",
  "Lot",
  "Bidder",
  "Auctioneer",
  "Catalog",
  "Curio",
  "Relic",
  "Artifact",
  "Heirloom",
  "Collectible",
  "Vase",
  "Urn",
  "Brooch",
  "Locket",
  "Pocketwatch",
  "Clock",
  "Cabinet",
  "Mirror",
  "Frame",
  "Trunk",
  "Chest",
  "Ledger",
  "Manuscript",
  "Map",
  "Portrait",
  "Engraving",
  "Tapestry",
  "Goblet",
  "Decanter",
  "Candlestick",
  "Candelabra",
  "Medallion",
  "Seal",
  "Figurine",
  "Timepiece",
  "Sideboard",
  "Armoire",
];

const AUCTION_ADJECTIVES = [
  "Rare",
  "Golden",
  "Silver",
  "Brass",
  "Velvet",
  "Hidden",
  "Forgotten",
  "Curious",
  "Timeless",
  "Historic",
  "Classic",
  "Elegant",
  "Ornate",
  "Delicate",
  "Treasured",
  "Secret",
  "Faded",
  "Polished",
  "Gilded",
  "Weathered",
  "Carved",
  "Framed",
  "Stately",
  "Regal",
  "Dusty",
  "Lost",
  "Grand",
  "Noble",
  "Estate",
  "Antique",
  "Vintage",
];

function isHeic(file: File) {
  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  return (
    type === "image/heic" ||
    type === "image/heif" ||
    name.endsWith(".heic") ||
    name.endsWith(".heif")
  );
}

export async function POST(request: NextRequest) {
  const rateLimitResponse = await enforceRateLimit(request, {
    scope: "api:upload:post",
    failClosed: true,
  });
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  try {
    const contentLength = request.headers?.get("content-length");
    if (!contentLength) {
      return NextResponse.json(
        { error: "Content-Length required" },
        { status: 411 },
      );
    }

    const requestBytes = Number(contentLength);
    if (!Number.isSafeInteger(requestBytes) || requestBytes < 0) {
      return NextResponse.json(
        { error: "Invalid Content-Length" },
        { status: 400 },
      );
    }

    if (requestBytes > MAX_REQUEST_BYTES) {
      return NextResponse.json({ error: "Request too large" }, { status: 413 });
    }

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch (error) {
      console.error("upload route formData error:", error);
      return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
    }

    const file = formData.get("file");

    // check if file is an instance of File
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "No file provided in 'file' field" },
        { status: 400 },
      );
    }

    if (file.size === 0) {
      return NextResponse.json({ error: "File is empty" }, { status: 400 });
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: "File too large (max 15MB)" },
        { status: 413 },
      );
    }

    const heic = isHeic(file);

    // Browsers sometimes omit the MIME type for HEIC, so its extension is the
    // only exception to the explicit decoder allowlist.
    if (!ALLOWED_IMAGE_TYPES.has(file.type.toLowerCase()) && !heic) {
      return NextResponse.json(
        { error: "Unsupported image type" },
        { status: 400 },
      );
    }

    let body: Buffer = Buffer.from(await file.arrayBuffer());

    // sharp's prebuilt binaries ship without a HEIC/HEVC decoder, so decode
    // HEIC/HEIF to JPEG first using heic-convert (libheif compiled to wasm).
    if (heic) {
      try {
        // heic-convert spreads the input internally, so it needs an iterable
        // Buffer/Uint8Array (its bundled @types incorrectly demand ArrayBuffer).
        const jpeg = await convert({
          buffer: body as unknown as ArrayBuffer,
          format: "JPEG",
          quality: 0.9,
        });
        body = Buffer.from(jpeg);
      } catch (error) {
        console.error("upload route HEIC decode error:", error);
        return NextResponse.json(
          { error: "Unsupported or corrupt image" },
          { status: 400 },
        );
      }
    }

    try {
      body = await sharp(body, { limitInputPixels: MAX_INPUT_PIXELS })
        .rotate()
        .resize(STORED_MAX_EDGE, STORED_MAX_EDGE, {
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality: STORED_JPEG_QUALITY })
        .toBuffer();
    } catch (error) {
      console.error("upload route image processing error:", error);
      return NextResponse.json(
        { error: "Unsupported or corrupt image" },
        { status: 400 },
      );
    }

    const ownerId = getOrCreateQueryOwnerId(request);
    const key = nanoid();
    const command = new PutObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: key,
      Body: body,
      ContentType: "image/jpeg",
    });

    await s3Client.send(command);

    // The bytes are now in S3. Record the Image row. If this fails, the bytes
    // are orphaned, so issue a best-effort compensating delete (see
    // docs/adr/0001) and surface the failure.
    let id: string;
    try {
      const [inserted] = await db
        .insert(queries)
        .values({
          owner_id: ownerId,
          image_key: key,
          title: `${AUCTION_ADJECTIVES[Math.floor(Math.random() * AUCTION_ADJECTIVES.length)]} ${AUCTION_NOUNS[Math.floor(Math.random() * AUCTION_NOUNS.length)]}`,
        })
        .returning({ id: queries.id });
      id = inserted.id;
    } catch (error) {
      console.error("upload route db insert error:", error);
      try {
        await s3Client.send(
          new DeleteObjectCommand({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: key,
          }),
        );
      } catch (cleanupError) {
        console.error("upload route compensating delete error:", cleanupError);
      }
      return NextResponse.json({ error: "Upload failed" }, { status: 500 });
    }

    const response = NextResponse.json({ id });
    setQueryOwnerCookie(response, ownerId);
    return response;
  } catch (error) {
    console.error("upload route error:", error);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
