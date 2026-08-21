ALTER TABLE "app_settings" ADD COLUMN "require_zdr" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "model_profiles" ADD COLUMN "zdr" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "stories" ADD COLUMN "zdr" boolean DEFAULT false NOT NULL;