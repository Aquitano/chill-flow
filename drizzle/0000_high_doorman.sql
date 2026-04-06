CREATE TABLE "focus_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"mode" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"durationSeconds" integer NOT NULL,
	"trackId" text,
	"startedAt" timestamp DEFAULT now() NOT NULL,
	"completedAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_presets" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"name" text NOT NULL,
	"trackId" text,
	"backgroundId" text,
	"mode" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"text" text NOT NULL,
	"priority" text NOT NULL,
	"isCompleted" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tracks" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"artist" text NOT NULL,
	"category" text NOT NULL,
	"durationSec" integer NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"variants" jsonb NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"userId" text PRIMARY KEY NOT NULL,
	"defaultMode" text NOT NULL,
	"autoPlay" boolean DEFAULT false NOT NULL,
	"transitionSpeed" integer DEFAULT 300 NOT NULL,
	"volume" integer DEFAULT 50 NOT NULL,
	"showNotifications" boolean DEFAULT true NOT NULL,
	"theme" text DEFAULT 'dark' NOT NULL,
	"selectedTrackId" text,
	"selectedBackgroundId" text,
	"likedTrackIds" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "FocusSessions_userId_status_completedAt_idx" ON "focus_sessions" USING btree ("userId","status","completedAt");--> statement-breakpoint
CREATE INDEX "Post_name_idx" ON "posts" USING btree ("name");--> statement-breakpoint
CREATE INDEX "SavedPresets_userId_idx" ON "saved_presets" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "Tasks_userId_createdAt_idx" ON "tasks" USING btree ("userId","createdAt");--> statement-breakpoint
CREATE INDEX "Tracks_category_idx" ON "tracks" USING btree ("category");--> statement-breakpoint
CREATE INDEX "UserPreferences_defaultMode_idx" ON "user_preferences" USING btree ("defaultMode");