ALTER TABLE "stories" ADD COLUMN "tint_hue" integer;--> statement-breakpoint
ALTER TABLE "stories" ADD COLUMN "tint_strength" double precision DEFAULT 1 NOT NULL;