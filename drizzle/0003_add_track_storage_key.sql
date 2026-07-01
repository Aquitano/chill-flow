-- Add with a transient default so the NOT NULL constraint holds for any pre-existing rows,
-- then drop it so new inserts must supply a real key (matches the schema: NOT NULL, no default).
ALTER TABLE "tracks" ADD COLUMN "storageKey" text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE "tracks" ALTER COLUMN "storageKey" DROP DEFAULT;
