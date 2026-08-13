// lib/db/schema.ts — Drizzle schema for the Postgres database.
// Column names are snake_case on disk; lib/db/mappers.ts converts rows to the
// camelCase domain types in lib/types.ts. Components never see these types.
//
// Two deliberate non-idiomatic choices, both to keep the mapping layer trivial:
// timestamps are ISO-8601 `text` rather than `timestamptz` (lib/format.ts works
// on ISO strings), and trigger keys are a JSON `text` blob rather than `jsonb`
// (nothing queries inside them yet). Both are cheap to migrate later.

import { sql } from "drizzle-orm"
import {
  boolean,
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core"

import type { OpKind } from "@/lib/history/ops"
import type { ThinkingLevel } from "@/lib/types"

export const stories = pgTable("stories", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  genre: text("genre").notNull().default(""),
  memory: text("memory").notNull().default(""),
  authorsNote: text("authors_note").notNull().default(""),
  // Nullable on purpose: NULL means "use the built-in narrator prompt", which
  // is a different state from an empty override and lets the default keep
  // evolving for every story that never set one.
  systemPrompt: text("system_prompt"),
  // Generation settings live inline (1:1 with the story).
  modelId: text("model_id").notNull(),
  // Reasoning effort, or "off". Thinking is opt-in, so "off" is the default
  // for new stories and for every story that predates this column.
  thinking: text("thinking").notNull().default("off").$type<ThinkingLevel>(),
  // OpenRouter endpoint tag, or NULL for Auto routing. Nullable rather than
  // defaulted to "auto": Auto is the absence of a choice, and every story that
  // predates this column has made no choice. Deliberately not a foreign key or
  // enum — the set of endpoints is a live remote catalog, not our data.
  providerTag: text("provider_tag"),
  // doublePrecision, not real: Postgres `real` is 4-byte and would silently
  // round the slider values that SQLite stored at 8-byte precision.
  temperature: doublePrecision("temperature").notNull(),
  topP: doublePrecision("top_p").notNull(),
  maxTokens: integer("max_tokens").notNull(),
  // Input-token budget for composeContext, not an output cap. Defaulted in the
  // schema (not just in application code) so the generated ALTER TABLE
  // backfills every story that predates the column with the same 8192.
  contextWindow: integer("context_window").notNull().default(8192),
  frequencyPenalty: doublePrecision("frequency_penalty").notNull(),
  presencePenalty: doublePrecision("presence_penalty").notNull(),
  // Seq of the newest APPLIED op; 0 means none. Everything above it is the redo
  // tail, kept on disk so redo need not reconstruct anything. On the story
  // rather than derived from the ops table because "which op is current" is a
  // position, not a fact about any one op.
  undoCursor: integer("undo_cursor").notNull().default(0),
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
    // The prose the canvas renders and the model sees. For a player action it
    // is the second-person translation, never the writer's raw input.
    text: text("text").notNull(),
    // Both nullable, and deliberately without a default: NULL/NULL means "this
    // row is not a player action", which is true of every generated passage,
    // every user passage written before Say/Do existed, and the opening
    // passage the NovelAI importer writes. A default would claim those rows
    // were Do actions typed by the writer, so this column stays un-backfilled
    // and the pair is always NULL together or set together.
    actionKind: text("action_kind").$type<"say" | "do">(),
    inputText: text("input_text"),
    /**
     * The slot this passage occupies; every alternative take shares it, which
     * is what makes a retry an insert beside the old take rather than an
     * overwrite. Backfilled to the row's own id, so older passages are slots
     * with one take in them.
     */
    variantGroupId: text("variant_group_id").notNull(),
    /** Order among the slot's takes; newest is highest, so next is MAX + 1. */
    variantIndex: integer("variant_index").notNull().default(0),
    /**
     * Exactly one take per slot is active: the one the canvas renders and
     * composeContext sends. The rest are kept and stay reachable.
     */
    isActive: boolean("is_active").notNull().default(true),
    /** NULL means live. Soft delete keeps `position`, so undo is one UPDATE. */
    deletedAt: text("deleted_at"),
    // Provenance for generated rows, captured at generation time rather than
    // read back from the story's settings, which may since have changed. Null
    // on user passages and pre-migration rows — a guess would be
    // indistinguishable from a record.
    genModelId: text("gen_model_id"),
    genThinking: text("gen_thinking").$type<ThinkingLevel>(),
    genTemperature: doublePrecision("gen_temperature"),
    promptTokens: integer("prompt_tokens"),
    completionTokens: integer("completion_tokens"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    // Partial, keeping its original name: a position is unique only among rows
    // actually in the manuscript. Deleted rows and inactive takes keep theirs,
    // so an unconditional index would reject the very first retry.
    uniqueIndex("story_entries_story_id_position_idx")
      .on(table.storyId, table.position)
      .where(sql`"deleted_at" is null and "is_active"`),
    index("story_entries_group_idx").on(table.storyId, table.variantGroupId),
  ]
)

/**
 * The undo journal: one row per reversible thing the writer did.
 *
 * `text` rather than `jsonb` for the same reason as the lorebook's keys —
 * nothing queries inside it. Its only reader is parsePayload, which returns
 * null on anything unrecognised, so a corrupt row disables undo rather than
 * breaking the story.
 */
export const storyOps = pgTable(
  "story_ops",
  {
    id: text("id").primaryKey(),
    storyId: text("story_id")
      .notNull()
      .references(() => stories.id, { onDelete: "cascade" }),
    /** Per-story, contiguous from 1, and compared against `stories.undoCursor`. */
    seq: integer("seq").notNull(),
    kind: text("kind").notNull().$type<OpKind>(),
    /**
     * Set only on `turn` ops: a Send and its generation are two writes that
     * undo as one step, so both halves upsert on this key.
     */
    turnId: text("turn_id"),
    /** Writer-facing description, e.g. "Retry" — what the undo tooltip says. */
    summary: text("summary").notNull(),
    payloadJson: text("payload_json").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("story_ops_story_id_seq_idx").on(table.storyId, table.seq),
    // Postgres treats NULLs as distinct in a unique index, so every non-turn op
    // (which has no turn_id) sits outside this constraint and they do not
    // collide with each other.
    uniqueIndex("story_ops_story_id_turn_id_idx").on(
      table.storyId,
      table.turnId
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
  defaultThinking: text("default_thinking")
    .notNull()
    .default("off")
    .$type<ThinkingLevel>(),
})

export type StoryRow = typeof stories.$inferSelect
export type StoryEntryRow = typeof storyEntries.$inferSelect
export type StoryOpRow = typeof storyOps.$inferSelect
export type LorebookEntryRow = typeof lorebookEntries.$inferSelect
export type AppSettingsRow = typeof appSettings.$inferSelect
