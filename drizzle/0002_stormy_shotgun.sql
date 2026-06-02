CREATE TYPE "public"."query_status" AS ENUM('pending', 'processing', 'ready', 'failed');--> statement-breakpoint
ALTER TABLE "queries" ADD COLUMN "status" "query_status" DEFAULT 'pending' NOT NULL;