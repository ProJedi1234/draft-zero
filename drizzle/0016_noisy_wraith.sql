CREATE TABLE "story_recaps" (
	"id" text PRIMARY KEY NOT NULL,
	"story_id" text NOT NULL,
	"through_entry_id" text NOT NULL,
	"through_position" integer NOT NULL,
	"text" text NOT NULL,
	"gen_model_id" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "story_recaps" ADD CONSTRAINT "story_recaps_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_recaps" ADD CONSTRAINT "story_recaps_through_entry_id_story_entries_id_fk" FOREIGN KEY ("through_entry_id") REFERENCES "public"."story_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "story_recaps_story_coverage_idx" ON "story_recaps" USING btree ("story_id","through_position","created_at");