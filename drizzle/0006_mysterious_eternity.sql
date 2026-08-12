-- Per-story INPUT context budget, in tokens, for lib/generation/context.ts.
-- Distinct from max_tokens, which caps output. The DEFAULT backfills every
-- story that predates the column with 8192 — the middle of the ladder in
-- lib/types.ts (CONTEXT_WINDOWS), and close to the fixed 24k/8k character
-- budgets composeContext used before the setting existed.
ALTER TABLE "stories" ADD COLUMN "context_window" integer DEFAULT 8192 NOT NULL;
