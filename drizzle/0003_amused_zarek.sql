-- Per-story narrator prompt override. Nullable with no default and no backfill:
-- NULL means "follow the built-in prompt in lib/generation/system-prompt.ts",
-- so every existing story picks up the default and keeps tracking it as it
-- changes. Only a story whose override is set in the inspector stores text.
ALTER TABLE "stories" ADD COLUMN "system_prompt" text;
