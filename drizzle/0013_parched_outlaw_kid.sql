ALTER TABLE "app_settings" ADD COLUMN "default_lore_budget" integer DEFAULT 25 NOT NULL;--> statement-breakpoint
ALTER TABLE "model_profiles" ADD COLUMN "lore_budget" integer;--> statement-breakpoint
ALTER TABLE "stories" ADD COLUMN "lore_budget" integer DEFAULT 25 NOT NULL;