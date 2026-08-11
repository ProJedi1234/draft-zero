-- Scope the lorebook to a story. Hand-edited after generation: drizzle-kit
-- emits a bare `ADD COLUMN ... NOT NULL`, which cannot apply to a table that
-- already has rows, so the column arrives nullable and is backfilled first.
--
-- Backfill: every pre-existing entry was globally visible, so it is copied to
-- each story — no lore is lost, and unwanted copies can be deleted in the UI.
-- The original row keeps its id and is attached to the oldest story; entries
-- left over when no stories exist at all are dropped.
DROP INDEX "lorebook_entries_name_idx";--> statement-breakpoint
ALTER TABLE "lorebook_entries" ADD COLUMN "story_id" text;--> statement-breakpoint
INSERT INTO "lorebook_entries" (
  "id", "story_id", "name", "category", "keys_json", "content",
  "enabled", "always_active", "priority", "created_at", "updated_at"
)
SELECT
  gen_random_uuid()::text, s."id", e."name", e."category", e."keys_json",
  e."content", e."enabled", e."always_active", e."priority",
  e."created_at", e."updated_at"
FROM "lorebook_entries" e
CROSS JOIN "stories" s
WHERE e."story_id" IS NULL
  AND s."id" <> (SELECT "id" FROM "stories" ORDER BY "created_at", "id" LIMIT 1);--> statement-breakpoint
UPDATE "lorebook_entries"
SET "story_id" = (SELECT "id" FROM "stories" ORDER BY "created_at", "id" LIMIT 1)
WHERE "story_id" IS NULL;--> statement-breakpoint
DELETE FROM "lorebook_entries" WHERE "story_id" IS NULL;--> statement-breakpoint
ALTER TABLE "lorebook_entries" ALTER COLUMN "story_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "lorebook_entries" ADD CONSTRAINT "lorebook_entries_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lorebook_entries_story_id_name_idx" ON "lorebook_entries" USING btree ("story_id","name");
