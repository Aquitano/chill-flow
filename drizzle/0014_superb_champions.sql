ALTER TABLE "saved_presets" ADD COLUMN "ambientLevels" jsonb;--> statement-breakpoint
ALTER TABLE "saved_presets" ADD COLUMN "timerMode" text;--> statement-breakpoint
ALTER TABLE "saved_presets" ADD COLUMN "timerPreset" text;--> statement-breakpoint
ALTER TABLE "saved_presets" ADD COLUMN "customMinutes" text;--> statement-breakpoint
ALTER TABLE "saved_presets" ADD COLUMN "pomodoroSettings" jsonb;