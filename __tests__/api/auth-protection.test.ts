import { expect, test, vi } from "vitest";
import { auth } from "@clerk/nextjs/server";
import { POST as upload } from "@/app/api/upload/route";
import { GET as listQueries } from "@/app/api/queries/route";
import {
  DELETE as deleteQuery,
  GET as getQuery,
} from "@/app/api/queries/[id]/route";
import {
  GET as getMatches,
  POST as createMatches,
} from "@/app/api/queries/[id]/matches/route";
import type { NextRequest } from "next/server";

const request = new Request("http://localhost/api/queries") as NextRequest;
const context = { params: Promise.resolve({ id: "query-id" }) };

test("all application API handlers require authentication", async () => {
  const unauthorized = new Error("Unauthenticated");
  const handlers = [
    () => upload(request),
    () => listQueries(request),
    () => getQuery(request, context),
    () => deleteQuery(request, context),
    () => getMatches(request, context),
    () => createMatches(request, context),
  ];

  for (const handler of handlers) {
    vi.mocked(auth.protect).mockRejectedValueOnce(unauthorized);
    await expect(handler()).rejects.toBe(unauthorized);
  }
});
