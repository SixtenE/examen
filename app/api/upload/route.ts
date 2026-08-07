import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import convert from "heic-convert";
import { nanoid } from "nanoid";
import { db } from "@/db";
import { queries } from "@/db/schema";
import { DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { s3Client } from "@/lib/s3";
import { enforceRateLimit } from "@/lib/rate-limit";
import { trackServerError, trackServerEvent, withSpan } from "@/lib/telemetry";
import { SeverityNumber } from "@opentelemetry/api-logs";

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15MB
const STORED_MAX_EDGE = 1500;
const STORED_JPEG_QUALITY = 80;

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
  const startedAt = performance.now();
  const uploadSourceHeader = request.headers?.get("x-upload-source");
  const uploadSource =
    uploadSourceHeader === "drop" || uploadSourceHeader === "picker"
      ? uploadSourceHeader
      : "api";
  const rateLimitResponse = await enforceRateLimit(request, {
    scope: "api:upload:post",
  });
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  try {
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      trackServerEvent(
        request,
        "image_upload_rejected",
        { reason: "invalid_form_data", status: "rejected" },
        SeverityNumber.WARN,
      );
      return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
    }

    const file = formData.get("file");

    // check if file is an instance of File
    if (!(file instanceof File)) {
      trackServerEvent(
        request,
        "image_upload_rejected",
        { reason: "missing_file", status: "rejected" },
        SeverityNumber.WARN,
      );
      return NextResponse.json(
        { error: "No file provided in 'file' field" },
        { status: 400 },
      );
    }

    if (file.size === 0) {
      trackServerEvent(
        request,
        "image_upload_rejected",
        { reason: "empty_file", status: "rejected" },
        SeverityNumber.WARN,
      );
      return NextResponse.json({ error: "File is empty" }, { status: 400 });
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      trackServerEvent(
        request,
        "image_upload_rejected",
        {
          reason: "file_too_large",
          status: "rejected",
          input_bytes: file.size,
        },
        SeverityNumber.WARN,
      );
      return NextResponse.json(
        { error: "File too large (max 15MB)" },
        { status: 413 },
      );
    }

    const heic = isHeic(file);

    // check if file is an image (browsers sometimes report an empty type for
    // HEIC, so allow it through when detected by extension)
    if (!file.type.startsWith("image/") && !heic) {
      trackServerEvent(
        request,
        "image_upload_rejected",
        {
          reason: "not_an_image",
          status: "rejected",
          input_mime: file.type || "unknown",
        },
        SeverityNumber.WARN,
      );
      return NextResponse.json(
        { error: "File is not an image" },
        { status: 400 },
      );
    }

    let body: Buffer = Buffer.from(await file.arrayBuffer());
    let contentType: string | undefined = file.type || undefined;

    // sharp's prebuilt binaries ship without a HEIC/HEVC decoder, so decode
    // HEIC/HEIF to JPEG first using heic-convert (libheif compiled to wasm).
    if (heic) {
      try {
        // heic-convert spreads the input internally, so it needs an iterable
        // Buffer/Uint8Array (its bundled @types incorrectly demand ArrayBuffer).
        const jpeg = await withSpan("image.decode_heic", {}, () =>
          convert({
            buffer: body as unknown as ArrayBuffer,
            format: "JPEG",
            quality: 0.9,
          }),
        );
        body = Buffer.from(jpeg);
        contentType = "image/jpeg";
      } catch {
        trackServerEvent(
          request,
          "image_upload_rejected",
          { reason: "heic_decode_failed", status: "rejected" },
          SeverityNumber.WARN,
        );
        return NextResponse.json(
          { error: "Unsupported or corrupt image" },
          { status: 400 },
        );
      }
    }

    try {
      body = await withSpan("image.normalize", {}, () =>
        sharp(body)
          .rotate()
          .resize(STORED_MAX_EDGE, STORED_MAX_EDGE, {
            fit: "inside",
            withoutEnlargement: true,
          })
          .jpeg({ quality: STORED_JPEG_QUALITY })
          .toBuffer(),
      );
      contentType = "image/jpeg";
    } catch {
      trackServerEvent(
        request,
        "image_upload_rejected",
        { reason: "image_processing_failed", status: "rejected" },
        SeverityNumber.WARN,
      );
      return NextResponse.json(
        { error: "Unsupported or corrupt image" },
        { status: 400 },
      );
    }

    const key = nanoid();
    const command = new PutObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: key,
      Body: body,
      ContentType: contentType,
    });

    await withSpan("storage.upload_image", { stored_bytes: body.length }, () =>
      s3Client.send(command),
    );

    // The bytes are now in S3. Record the Image row. If this fails, the bytes
    // are orphaned, so issue a best-effort compensating delete (see
    // docs/adr/0001) and surface the failure.
    let id: string;
    try {
      const [inserted] = await withSpan("db.create_query", {}, () =>
        db
          .insert(queries)
          .values({
            image_key: key,
            title: `${AUCTION_ADJECTIVES[Math.floor(Math.random() * AUCTION_ADJECTIVES.length)]} ${AUCTION_NOUNS[Math.floor(Math.random() * AUCTION_NOUNS.length)]}`,
          })
          .returning({ id: queries.id }),
      );
      id = inserted.id;
    } catch (error) {
      trackServerError(request, error, "query_create");
      try {
        await withSpan("storage.cleanup_orphaned_image", {}, () =>
          s3Client.send(
            new DeleteObjectCommand({
              Bucket: process.env.AWS_BUCKET_NAME,
              Key: key,
            }),
          ),
        );
      } catch (cleanupError) {
        trackServerError(request, cleanupError, "orphaned_image_cleanup");
      }
      return NextResponse.json({ error: "Upload failed" }, { status: 500 });
    }

    trackServerEvent(request, "image_uploaded", {
      query_id: id,
      source: uploadSource,
      input_bytes: file.size,
      stored_bytes: body.length,
      input_mime: file.type || "unknown",
      was_heic: heic,
      duration_ms: Math.round(performance.now() - startedAt),
    });

    return NextResponse.json({ id, key });
  } catch (error) {
    trackServerError(request, error, "image_upload", {
      duration_ms: Math.round(performance.now() - startedAt),
    });
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
