ALTER TABLE "app_settings" ADD COLUMN "summary_temperature" double precision DEFAULT 0.3 NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "summary_target_words" integer;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "summary_max_tokens" integer;