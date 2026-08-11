CREATE TABLE "app_settings" (
	"id" integer PRIMARY KEY NOT NULL,
	"default_model_id" text NOT NULL,
	"openrouter_key" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lorebook_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"keys_json" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"always_active" boolean DEFAULT false NOT NULL,
	"priority" integer DEFAULT 50 NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stories" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"genre" text DEFAULT '' NOT NULL,
	"memory" text DEFAULT '' NOT NULL,
	"authors_note" text DEFAULT '' NOT NULL,
	"model_id" text NOT NULL,
	"temperature" double precision NOT NULL,
	"top_p" double precision NOT NULL,
	"max_tokens" integer NOT NULL,
	"frequency_penalty" double precision NOT NULL,
	"presence_penalty" double precision NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "story_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"story_id" text NOT NULL,
	"position" integer NOT NULL,
	"source" text NOT NULL,
	"text" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "story_entries" ADD CONSTRAINT "story_entries_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lorebook_entries_name_idx" ON "lorebook_entries" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "story_entries_story_id_position_idx" ON "story_entries" USING btree ("story_id","position");