import { randomUUID } from "node:crypto";
import type { NextResponse } from "next/server";
import { isUuid } from "@/lib/utils";

const OWNER_COOKIE = "examen-owner";

export function getQueryOwnerId(request: Request) {
  const cookie = request.headers
    ?.get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${OWNER_COOKIE}=`))
    ?.slice(OWNER_COOKIE.length + 1);

  return cookie && isUuid(cookie) ? cookie : null;
}

export function getOrCreateQueryOwnerId(request: Request) {
  return getQueryOwnerId(request) ?? randomUUID();
}

export function setQueryOwnerCookie(response: NextResponse, ownerId: string) {
  response.cookies.set(OWNER_COOKIE, ownerId, {
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}
