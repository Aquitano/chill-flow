CREATE TABLE "ambient_mixes" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"name" text NOT NULL,
	"levels" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ambient_sounds" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"category" text NOT NULL,
	"storageKey" text NOT NULL,
	"gainPercent" integer DEFAULT 100 NOT NULL,
	"sortIndex" integer DEFAULT 0 NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "AmbientMixes_userId_idx" ON "ambient_mixes" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "AmbientSounds_isActive_sortIndex_idx" ON "ambient_sounds" USING btree ("isActive","sortIndex");