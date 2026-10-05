import {
  index,
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

export const queries = pgTable(
  "queries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    owner_id: uuid("owner_id").notNull().defaultRandom(),
    title: varchar("title").notNull(),
    image_key: varchar("image_key").notNull().unique(),
    status: queryStatus("status").notNull().default("pending"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("queries_owner_created_at_id_idx").on(
      table.owner_id,
      table.createdAt.desc(),
      table.id.desc(),
    ),
  ],
);

export const matches = pgTable(
  "matches",
  {
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
    sold_at: timestamp("sold_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [index("matches_query_id_idx").on(table.query_id)],
);
