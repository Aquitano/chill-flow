ALTER TABLE "focus_sessions" RENAME COLUMN "durationSeconds" TO "plannedDurationSeconds";--> statement-breakpoint
ALTER TABLE "focus_sessions" ADD COLUMN "elapsedSeconds" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "focus_sessions" ADD COLUMN "canceledAt" timestamp;--> statement-breakpoint
UPDATE "focus_sessions"
SET "elapsedSeconds" = CASE
    WHEN "status" = 'completed' THEN "plannedDurationSeconds"
    ELSE 0
END;
