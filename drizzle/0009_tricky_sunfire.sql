CREATE TABLE "story_ops" (
	"id" text PRIMARY KEY NOT NULL,
	"story_id" text NOT NULL,
	"seq" integer NOT NULL,
	"kind" text NOT NULL,
	"turn_id" text,
	"summary" text NOT NULL,
	"payload_json" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
DROP INDEX "story_entries_story_id_position_idx";--> statement-breakpoint
ALTER TABLE "stories" ADD COLUMN "undo_cursor" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "story_entries" ADD COLUMN "variant_group_id" text;--> statement-breakpoint
UPDATE "story_entries" SET "variant_group_id" = "id";--> statement-breakpoint
ALTER TABLE "story_entries" ALTER COLUMN "variant_group_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "story_entries" ADD COLUMN "variant_index" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "story_entries" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "story_entries" ADD COLUMN "deleted_at" text;--> statement-breakpoint
ALTER TABLE "story_entries" ADD COLUMN "gen_model_id" text;--> statement-breakpoint
ALTER TABLE "story_entries" ADD COLUMN "gen_thinking" text;--> statement-breakpoint
ALTER TABLE "story_entries" ADD COLUMN "gen_temperature" double precision;--> statement-breakpoint
ALTER TABLE "story_entries" ADD COLUMN "prompt_tokens" integer;--> statement-breakpoint
ALTER TABLE "story_entries" ADD COLUMN "completion_tokens" integer;--> statement-breakpoint
ALTER TABLE "story_ops" ADD CONSTRAINT "story_ops_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "story_ops_story_id_seq_idx" ON "story_ops" USING btree ("story_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "story_ops_story_id_turn_id_idx" ON "story_ops" USING btree ("story_id","turn_id");--> statement-breakpoint
CREATE INDEX "story_entries_group_idx" ON "story_entries" USING btree ("story_id","variant_group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "story_entries_story_id_position_idx" ON "story_entries" USING btree ("story_id","position") WHERE "deleted_at" is null and "is_active";