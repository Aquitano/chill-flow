ALTER TABLE "user_preferences" ADD COLUMN "timerMode" text DEFAULT 'focus' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "timerPreset" text DEFAULT '25m' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "customMinutes" text DEFAULT '25' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "pomodoroSettings" jsonb DEFAULT '{"focusMinutes":25,"breakMinutes":5,"longBreakMinutes":15,"sessionsBeforeLongBreak":4}'::jsonb NOT NULL;