ALTER TABLE "generation_calls" ADD COLUMN "subject_group_id" text;--> statement-breakpoint
-- Hand-added: link world passes made before the column. A story runs one pass
-- at a time and stores its patch before settling, so the window is exact.
UPDATE "generation_calls" AS c
SET "subject_group_id" = e."variant_group_id"
FROM "world_patches" AS p
JOIN "story_entries" AS e ON e."id" = p."entry_id"
WHERE c."request_kind" = 'world'
  AND c."subject_group_id" IS NULL
  AND p."source" = 'world'
  AND p."story_id" = c."story_id"
  AND p."created_at" BETWEEN c."created_at" AND c."settled_at";
