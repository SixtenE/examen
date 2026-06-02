ALTER TABLE "matches" ALTER COLUMN "similarity_score" SET DATA TYPE real USING "similarity_score"::real;--> statement-breakpoint
ALTER TABLE "matches" ALTER COLUMN "query_id" SET NOT NULL;
