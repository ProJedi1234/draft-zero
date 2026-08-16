ALTER TABLE "model_profiles" ALTER COLUMN "temperature" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "model_profiles" ALTER COLUMN "top_p" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "model_profiles" ALTER COLUMN "max_tokens" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "model_profiles" ALTER COLUMN "context_window" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "model_profiles" ALTER COLUMN "context_window" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "model_profiles" ALTER COLUMN "frequency_penalty" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "model_profiles" ALTER COLUMN "presence_penalty" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "default_temperature" double precision DEFAULT 0.9 NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "default_top_p" double precision DEFAULT 0.95 NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "default_max_tokens" integer DEFAULT 1024 NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "default_context_window" integer DEFAULT 8192 NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "default_frequency_penalty" double precision DEFAULT 0.15 NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "default_presence_penalty" double precision DEFAULT 0.1 NOT NULL;