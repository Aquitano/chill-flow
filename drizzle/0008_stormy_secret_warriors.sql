ALTER TABLE "focus_sessions" ADD COLUMN "timerKind" text DEFAULT 'focus' NOT NULL;--> statement-breakpoint
ALTER TABLE "focus_sessions" ADD COLUMN "cycleCompletedAt" timestamp;