ALTER TABLE "app_settings" ADD COLUMN "summary_model_id" text;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "summary_thinking" text DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "summary_provider_tag" text;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "summary_zdr" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "stories" ADD COLUMN "summarize" boolean DEFAULT true NOT NULL;