ALTER TABLE "app_settings" DROP COLUMN "default_max_tokens";--> statement-breakpoint
ALTER TABLE "model_profiles" DROP COLUMN "max_tokens";--> statement-breakpoint
ALTER TABLE "stories" DROP COLUMN "max_tokens";