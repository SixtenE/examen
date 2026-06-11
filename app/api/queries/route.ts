import { db } from "@/db";
import { queries } from "@/db/schema";
import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, lt, or } from "drizzle-orm";

const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 50;

type QueryCursor = {
  createdAt: string;
  id: string;
};

function encodeCursor(cursor: QueryCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeCursor(value: string): QueryCursor | null {
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as QueryCursor;
    if (
      typeof parsed.createdAt !== "string" ||
      typeof parsed.id !== "string" ||
      Number.isNaN(Date.parse(parsed.createdAt))
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const limitParam = Number.parseInt(searchParams.get("limit") ?? "", 10);
    const limit = Number.isNaN(limitParam)
      ? DEFAULT_LIMIT
      : Math.min(Math.max(limitParam, 1), MAX_LIMIT);

    const cursorParam = searchParams.get("cursor");
    const cursor = cursorParam ? decodeCursor(cursorParam) : null;

    if (cursorParam && !cursor) {
      return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
    }

    const cursorDate = cursor ? new Date(cursor.createdAt) : null;

    const results = await db
      .select()
      .from(queries)
      .where(
        cursor && cursorDate
          ? or(
              lt(queries.createdAt, cursorDate),
              and(
                eq(queries.createdAt, cursorDate),
                lt(queries.id, cursor.id),
              ),
            )
          : undefined,
      )
      .orderBy(desc(queries.createdAt), desc(queries.id))
      .limit(limit + 1);

    const hasMore = results.length > limit;
    const items = hasMore ? results.slice(0, limit) : results;
    const lastItem = items.at(-1);

    return NextResponse.json({
      items,
      nextCursor:
        hasMore && lastItem
          ? encodeCursor({
              createdAt: lastItem.createdAt.toISOString(),
              id: lastItem.id,
            })
          : null,
    });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
