import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import convert from "heic-convert";
import { nanoid } from "nanoid";
import { db } from "@/db";
import { queries } from "@/db/schema";
import { DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { s3Client } from "@/lib/s3";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

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
  try {
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
        { error: "File too large (max 10MB)" },
        { status: 413 },
      );
    }

    const heic = isHeic(file);

    // check if file is an image (browsers sometimes report an empty type for
    // HEIC, so allow it through when detected by extension)
    if (!file.type.startsWith("image/") && !heic) {
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
        const jpeg = await convert({
          buffer: body as unknown as ArrayBuffer,
          format: "JPEG",
          quality: 0.9,
        });
        body = Buffer.from(jpeg);
        contentType = "image/jpeg";
      } catch (error) {
        console.error("upload route HEIC decode error:", error);
        return NextResponse.json(
          { error: "Unsupported or corrupt image" },
          { status: 400 },
        );
      }
    }

    // compress oversized images (>2MB)
    if (body.length > 2 * 1024 * 1024) {
      try {
        body = await sharp(body).jpeg({ quality: 100 }).toBuffer();
        contentType = "image/jpeg";
      } catch (error) {
        console.error("upload route image compression error:", error);
        return NextResponse.json(
          { error: "Unsupported or corrupt image" },
          { status: 400 },
        );
      }
    }

    const key = nanoid();
    const command = new PutObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: key,
      Body: body,
      ContentType: contentType,
    });

    await s3Client.send(command);

    // The bytes are now in S3. Record the Image row. If this fails, the bytes
    // are orphaned, so issue a best-effort compensating delete (see
    // docs/adr/0001) and surface the failure.
    let id: string;
    try {
      const [inserted] = await db
        .insert(queries)
        .values({ image_key: key })
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

    return NextResponse.json({ id, key });
  } catch (error) {
    console.error("upload route error:", error);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
