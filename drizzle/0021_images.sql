CREATE TABLE "story_images" (
	"id" text PRIMARY KEY NOT NULL,
	"story_id" text NOT NULL,
	"position" integer NOT NULL,
	"image_group_id" text NOT NULL,
	"image_index" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" text,
	"prompt" text NOT NULL,
	"derived_prompt" text,
	"model_id" text NOT NULL,
	"aspect_ratio" text NOT NULL,
	"seed" integer NOT NULL,
	"media_type" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "generation_calls" ADD COLUMN "story_image_id" text;--> statement-breakpoint
ALTER TABLE "generation_calls" ADD COLUMN "orig_image_group_id" text;--> statement-breakpoint
ALTER TABLE "stories" ADD COLUMN "image_model_id" text;--> statement-breakpoint
ALTER TABLE "story_images" ADD CONSTRAINT "story_images_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "story_images_position_idx" ON "story_images" USING btree ("story_id","position");--> statement-breakpoint
CREATE INDEX "story_images_group_idx" ON "story_images" USING btree ("story_id","image_group_id");--> statement-breakpoint
ALTER TABLE "generation_calls" ADD CONSTRAINT "generation_calls_story_image_id_story_images_id_fk" FOREIGN KEY ("story_image_id") REFERENCES "public"."story_images"("id") ON DELETE set null ON UPDATE no action;