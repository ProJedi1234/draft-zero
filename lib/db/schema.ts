// lib/db/schema.ts — Drizzle schema for the local SQLite database.
// Column names are snake_case on disk; lib/db/mappers.ts converts rows to the
// camelCase domain types in lib/types.ts. Components never see these types.

import { sql } from "drizzle-orm"
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"

export const stories = sqliteTable("stories", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  genre: text("genre").notNull().default(""),
  memory: text("memory").notNull().default(""),
  authorsNote: text("authors_note").notNull().default(""),
  // Generation settings live inline (1:1 with the story).
  modelId: text("model_id").notNull(),
  temperature: real("temperature").notNull(),
  topP: real("top_p").notNull(),
  maxTokens: integer("max_tokens").notNull(),
  frequencyPenalty: real("frequency_penalty").notNull(),
  presencePenalty: real("presence_penalty").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
})

export const storyEntries = sqliteTable(
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

export const lorebookEntries = sqliteTable(
  "lorebook_entries",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    category: text("category").notNull(),
    /** JSON-serialized string[] of trigger keys. */
    keysJson: text("keys_json").notNull(),
    content: text("content").notNull().default(""),
    enabled: integer("enabled", { mode: "boolean" })
      .notNull()
      .default(sql`1`),
    alwaysActive: integer("always_active", { mode: "boolean" })
      .notNull()
      .default(sql`0`),
    priority: integer("priority").notNull().default(50),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("lorebook_entries_name_idx").on(table.name)]
)

/** Single-row table; `id` is always 1. */
export const appSettings = sqliteTable("app_settings", {
  id: integer("id").primaryKey(),
  defaultModelId: text("default_model_id").notNull(),
  openRouterKey: text("openrouter_key").notNull().default(""),
})

export type StoryRow = typeof stories.$inferSelect
export type StoryEntryRow = typeof storyEntries.$inferSelect
export type LorebookEntryRow = typeof lorebookEntries.$inferSelect
export type AppSettingsRow = typeof appSettings.$inferSelect
