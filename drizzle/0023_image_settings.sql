ALTER TABLE "app_settings" ADD COLUMN "default_image_model_id" text;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "image_context_tokens" integer DEFAULT 4096 NOT NULL;