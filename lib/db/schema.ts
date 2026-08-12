// lib/db/schema.ts — Drizzle schema for the Postgres database.
// Column names are snake_case on disk; lib/db/mappers.ts converts rows to the
// camelCase domain types in lib/types.ts. Components never see these types.
//
// Two deliberate non-idiomatic choices, both to keep the mapping layer trivial:
// timestamps are ISO-8601 `text` rather than `timestamptz` (lib/format.ts works
// on ISO strings), and trigger keys are a JSON `text` blob rather than `jsonb`
// (nothing queries inside them yet). Both are cheap to migrate later.

import {
  boolean,
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core"

import type { ThinkingLevel } from "@/lib/types"

export const stories = pgTable("stories", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  genre: text("genre").notNull().default(""),
  memory: text("memory").notNull().default(""),
  authorsNote: text("authors_note").notNull().default(""),
  // Generation settings live inline (1:1 with the story).
  modelId: text("model_id").notNull(),
  // Reasoning effort, or "off". Thinking is opt-in, so "off" is the default
  // for new stories and for every story that predates this column.
  thinking: text("thinking").notNull().default("off").$type<ThinkingLevel>(),
  // doublePrecision, not real: Postgres `real` is 4-byte and would silently
  // round the slider values that SQLite stored at 8-byte precision.
  temperature: doublePrecision("temperature").notNull(),
  topP: doublePrecision("top_p").notNull(),
  maxTokens: integer("max_tokens").notNull(),
  frequencyPenalty: doublePrecision("frequency_penalty").notNull(),
  presencePenalty: doublePrecision("presence_penalty").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
})

export const storyEntries = pgTable(
  "story_entries",
  {
    id: text("id").primaryKey(),
    storyId: text("story_id")
      .notNull()
      .references(() => stories.id, { onDelete: "cascade" }),
    /** Per-story ordering key; next = MAX(position) + 1 (0 for the first). */
    position: integer("position").notNull(),
    source: text("source").notNull().$type<"user" | "generated">(),
    text: text("text").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("story_entries_story_id_position_idx").on(
      table.storyId,
      table.position
    ),
  ]
)

export const lorebookEntries = pgTable(
  "lorebook_entries",
  {
    id: text("id").primaryKey(),
    /** Lore is scoped to one story; there is no global lorebook. */
    storyId: text("story_id")
      .notNull()
      .references(() => stories.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    category: text("category").notNull(),
    /** JSON-serialized string[] of trigger keys. */
    keysJson: text("keys_json").notNull(),
    content: text("content").notNull().default(""),
    enabled: boolean("enabled").notNull().default(true),
    alwaysActive: boolean("always_active").notNull().default(false),
    priority: integer("priority").notNull().default(50),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("lorebook_entries_story_id_name_idx").on(table.storyId, table.name),
  ]
)

/** Single-row table; `id` is always 1. */
export const appSettings = pgTable("app_settings", {
  id: integer("id").primaryKey(),
  defaultModelId: text("default_model_id").notNull(),
})

export type StoryRow = typeof stories.$inferSelect
export type StoryEntryRow = typeof storyEntries.$inferSelect
export type LorebookEntryRow = typeof lorebookEntries.$inferSelect
export type AppSettingsRow = typeof appSettings.$inferSelect
