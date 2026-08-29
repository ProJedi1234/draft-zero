ALTER TABLE "composer_drafts" ADD COLUMN "image_prompt" text;--> statement-breakpoint
ALTER TABLE "composer_drafts" ADD COLUMN "image_assisted" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "composer_drafts" ADD COLUMN "image_style" text;--> statement-breakpoint
ALTER TABLE "story_images" ADD COLUMN "source_prompt" text;--> statement-breakpoint
ALTER TABLE "story_images" ADD COLUMN "prompt_lore_ids_json" text;--> statement-breakpoint
ALTER TABLE "story_images" DROP COLUMN "derived_prompt";