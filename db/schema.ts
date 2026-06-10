import {
  pgEnum,
  pgTable,
  real,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const queryStatus = pgEnum("query_status", [
  "pending",
  "processing",
  "ready",
  "failed",
]);

export const queries = pgTable("queries", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: varchar("title").notNull(),
  image_key: varchar("image_key").notNull().unique(),
  status: queryStatus("status").notNull().default("pending"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const matches = pgTable("matches", {
  id: uuid("id").primaryKey().defaultRandom(),
  query_id: uuid("query_id")
    .notNull()
    .references(() => queries.id),
  auctionet_id: varchar("auctionet_id").notNull(),
  image_url: varchar("image_url").notNull(),
  title: varchar("title").notNull(),
  price: real("price").notNull(),
  currency: varchar("currency").notNull(),
  similarity_score: real("similarity_score").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
