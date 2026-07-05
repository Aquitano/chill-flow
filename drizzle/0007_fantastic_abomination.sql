ALTER TABLE "tasks" ADD COLUMN "dueAt" timestamp;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "dueHasTime" boolean DEFAULT false NOT NULL;