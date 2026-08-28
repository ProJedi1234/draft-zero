CREATE TABLE "composer_drafts" (
	"story_id" text PRIMARY KEY NOT NULL,
	"text" text NOT NULL,
	"mode" text DEFAULT 'do' NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "composer_drafts" ADD CONSTRAINT "composer_drafts_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;