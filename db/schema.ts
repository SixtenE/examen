import {
  pgTable,
  real,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const queries = pgTable("queries", {
  id: uuid("id").primaryKey().defaultRandom(),
  image_key: varchar("image_key").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const matches = pgTable("matches", {
  id: uuid("id").primaryKey().defaultRandom(),
  query_id: uuid("query_id")
    .notNull()
    .references(() => queries.id),
  auctionet_id: varchar("auctionet_id").notNull(),
  similarity_score: real("similarity_score").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
