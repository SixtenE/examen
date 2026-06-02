import { db } from "@/db";
import { queries } from "@/db/schema";
import { NextRequest, NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { s3Client } from "@/lib/s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { GetObjectCommand } from "@aws-sdk/client-s3";

export async function GET() {
  try {
    const results = await db
      .select()
      .from(queries)
      .orderBy(desc(queries.createdAt));

    const resultsWithImageUrls = await Promise.all(
      results.map(async (result) => {
        const image_url = await getSignedUrl(
          s3Client,
          new GetObjectCommand({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: result.image_key,
          }),
          {
            expiresIn: 60 * 60, // 1 hour
          },
        );
        return { ...result, image_url };
      }),
    );
    return NextResponse.json(resultsWithImageUrls);
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {}
