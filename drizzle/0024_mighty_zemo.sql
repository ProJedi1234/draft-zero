ALTER TABLE "app_settings" ADD COLUMN "atmosphere_model_id" text;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "atmosphere_thinking" text DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "atmosphere_provider_tag" text;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "atmosphere_zdr" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "atmosphere_temperature" double precision DEFAULT 0.2 NOT NULL;--> statement-breakpoint
ALTER TABLE "stories" ADD COLUMN "tint_auto" boolean DEFAULT true NOT NULL;--> statement-breakpoint
-- Hand-added, not generated: every story that already wears a hue was painted
-- by hand, and the column's default would hand all of them to the model.
UPDATE "stories" SET "tint_auto" = false WHERE "tint_hue" IS NOT NULL;