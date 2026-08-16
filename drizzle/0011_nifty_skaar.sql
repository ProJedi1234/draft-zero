CREATE TABLE "model_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"model_id" text NOT NULL,
	"thinking" text DEFAULT 'off' NOT NULL,
	"provider_tag" text,
	"temperature" double precision NOT NULL,
	"top_p" double precision NOT NULL,
	"max_tokens" integer NOT NULL,
	"context_window" integer DEFAULT 8192 NOT NULL,
	"frequency_penalty" double precision NOT NULL,
	"presence_penalty" double precision NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "default_profile_id" text;--> statement-breakpoint
ALTER TABLE "stories" ADD COLUMN "profile_id" text;