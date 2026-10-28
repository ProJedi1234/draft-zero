CREATE TABLE "world_patches" (
	"id" text PRIMARY KEY NOT NULL,
	"story_id" text NOT NULL,
	"entry_id" text,
	"source" text NOT NULL,
	"ops_json" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lorebook_entries" ADD COLUMN "npc" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "stories" ADD COLUMN "features_json" text;--> statement-breakpoint
ALTER TABLE "world_patches" ADD CONSTRAINT "world_patches_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_patches" ADD CONSTRAINT "world_patches_entry_id_story_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."story_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "world_patches_story_id_idx" ON "world_patches" USING btree ("story_id");--> statement-breakpoint
CREATE UNIQUE INDEX "world_patches_world_entry_idx" ON "world_patches" USING btree ("entry_id") WHERE "world_patches"."source" = 'world';