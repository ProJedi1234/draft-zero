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
  numeric,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core"

import type { OpKind } from "@/lib/history/ops"
import type {
  CostSource,
  GenerationCallStatus,
  GenerationRequestKind,
  ThinkingLevel,
} from "@/lib/types"

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

/**
 * The spend ledger: one row per OpenRouter call, minted when the request goes
 * out and never deleted.
 *
 * Deliberately NOT a column on story_entries. A call the writer stopped
 * mid-stream, or that died with a provider error, was still billed and still
 * has to be counted — and neither one leaves an entry behind to hang a column
 * off. For the same reason both foreign keys are nullable and neither cascades:
 * deleting a story deletes its manuscript, not the record that the money left
 * the account.
 *
 * `cost_usd` is numeric, not doublePrecision. Per-call costs run to eight and
 * nine decimal places and the whole point of the table is that a few thousand of
 * them add up to a number the writer compares against a credit balance; binary
 * float would drift in exactly the digit being checked. Drizzle maps numeric to
 * a JS string, which is correct here — the value is summed in SQL and formatted
 * for display, never arithmetic'd in JS.
 */
export const generationCalls = pgTable(
  "generation_calls",
  {
    id: text("id").primaryKey(),
    // Nullable + no cascade, on purpose (see the header). A NULL story_id is a
    // call whose story has since been deleted; the denormalised title below
    // keeps the row readable on its own after that happens.
    storyId: text("story_id").references(() => stories.id, {
      onDelete: "set null",
    }),
    /**
     * The take this call produced, stamped in a second write once the entry row
     * exists. NULL means either "not written yet" or "this call never became a
     * passage" — aborted, errored, or discarded.
     */
    storyEntryId: text("story_entry_id").references(() => storyEntries.id, {
      onDelete: "set null",
    }),
    /**
     * The story id as the request named it, deliberately WITHOUT a foreign key,
     * stamped at mint and never nulled. story_id above answers "does this story
     * still exist"; this column answers "which story was this" — a stable
     * grouping key that survives deletion, so two departed stories with the
     * same title stay two lines on the usage page instead of merging.
     */
    origStoryId: text("orig_story_id"),
    /**
     * The slot (story_entries.variant_group_id) this call's take landed in — no
     * FK, same afterlife rationale as orig_story_id. Stamped in the same write
     * as story_entry_id; NULL means the call never became a passage. Groups a
     * slot's takes so "what did re-rolling this passage cost in total" still
     * sums after the entries are gone.
     */
    origVariantGroupId: text("orig_variant_group_id"),
    /** Survives story deletion so a global ledger still reads as English. */
    storyTitle: text("story_title"),
    /** What the writer asked for. */
    requestKind: text("request_kind").notNull().$type<GenerationRequestKind>(),
    // Provenance, frozen, same philosophy as story_entries.gen*.
    modelId: text("model_id").notNull(),
    /**
     * The endpoint that actually served it, from the story's pin or the
     * reconciliation fetch. NULL for Auto routing we never resolved — which is
     * why story_entries alone cannot reconstruct a price.
     */
    providerName: text("provider_name"),
    thinking: text("thinking").$type<ThinkingLevel>(),
    promptTokens: integer("prompt_tokens"),
    completionTokens: integer("completion_tokens"),
    reasoningTokens: integer("reasoning_tokens"),
    /**
     * Prompt tokens served from the provider's cache, when it reports them. A
     * subset of prompt_tokens, not an addition to it. NULL means the provider
     * said nothing, which is different from "none were cached".
     */
    cachedPromptTokens: integer("cached_prompt_tokens"),
    /** Total, USD. NULL until known; stays NULL on a call we never priced. */
    costUsd: numeric("cost_usd", { precision: 20, scale: 12 }),
    /**
     * Upstream split, when OpenRouter's costDetails carries it. Purely for the
     * "why was this expensive" breakdown; never summed against costUsd.
     */
    upstreamPromptCostUsd: numeric("upstream_prompt_cost_usd", {
      precision: 20,
      scale: 12,
    }),
    upstreamCompletionCostUsd: numeric("upstream_completion_cost_usd", {
      precision: 20,
      scale: 12,
    }),
    /**
     * True when the call rode the writer's own upstream key, in which case
     * cost_usd is what the upstream charged, not what OpenRouter debited.
     */
    isByok: boolean("is_byok"),
    /**
     * OpenRouter's id for this generation, from the first stream chunk. The only
     * handle that can ask OpenRouter what a call actually cost, so it is
     * captured early — the abort path never reaches the final chunk.
     */
    openrouterGenerationId: text("openrouter_generation_id"),
    /**
     * "streaming" until the call resolves, then "ok" | "aborted" | "error". The
     * row is written BEFORE the outcome is known, so a call that dies without
     * ever sending a usage chunk still leaves a trace to reconcile against.
     */
    status: text("status").notNull().$type<GenerationCallStatus>(),
    /**
     * Where cost_usd came from: "stream" (the final chunk) or "reconciled" (the
     * /generation lookup, which may overwrite a streamed value). NULL while
     * cost_usd is NULL.
     */
    costSource: text("cost_source").$type<CostSource>(),
    createdAt: text("created_at").notNull(),
    /** When the outcome landed. NULL while status is "streaming". */
    settledAt: text("settled_at"),
  },
  (table) => [
    // Leading equality, trailing range: every story-scoped query filters story
    // then windows time.
    index("generation_calls_story_created_idx").on(
      table.storyId,
      table.createdAt
    ),
    index("generation_calls_created_idx").on(table.createdAt),
    index("generation_calls_entry_idx").on(table.storyEntryId),
    // Reconciliation idempotence. Partial because the column is NULL on every
    // call whose first chunk never arrived, and a plain unique index would
    // reject the second such row.
    uniqueIndex("generation_calls_openrouter_id_idx")
      .on(table.openrouterGenerationId)
      .where(sql`"openrouter_generation_id" is not null`),
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
export type GenerationCallRow = typeof generationCalls.$inferSelect
export type NewGenerationCallRow = typeof generationCalls.$inferInsert
export type LorebookEntryRow = typeof lorebookEntries.$inferSelect
export type AppSettingsRow = typeof appSettings.$inferSelect
