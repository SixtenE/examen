import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set");
}

const globalForDb = globalThis as unknown as {
  db?: ReturnType<typeof drizzle<typeof schema>>;
};

export const db = globalForDb.db ?? drizzle(databaseUrl, { schema });

if (process.env.NODE_ENV !== "production") {
  globalForDb.db = db;
}
