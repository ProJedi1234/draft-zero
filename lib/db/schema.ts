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
  // The profile this story follows, or NULL for Custom. Not a foreign key, for
  // the same reason provider_tag isn't: deleting a profile is not a cascade but
  // a state change on its followers (they flip to Custom seeded with the
  // deleted profile's settings), which the delete action does transactionally.
  profileId: text("profile_id"),
  // Generation settings live inline (1:1 with the story). Once a story follows
  // a profile these columns keep holding its CUSTOM settings — profile code
  // never writes them — which is what makes Custom ⇄ profile lossless.
  modelId: text("model_id").notNull(),
  // Reasoning effort, or "off". Thinking is opt-in, so "off" is the default
  // for new stories and for every story that predates this column.
  thinking: text("thinking").notNull().default("off").$type<ThinkingLevel>(),
  // OpenRouter endpoint tag, or NULL for Auto routing. Nullable rather than
  // defaulted to "auto": Auto is the absence of a choice, and every story that
  // predates this column has made no choice. Deliberately not a foreign key or
  // enum — the set of endpoints is a live remote catalog, not our data.
  providerTag: text("provider_tag"),
  // Route this story only through endpoints that retain nothing. Defaulted
  // false in the schema so the generated ALTER TABLE backfills every existing
  // story with the behaviour it has had all along; the app-wide policy in
  // app_settings.require_zdr ORs on top at read time, so a false here is "this
  // story asks for nothing extra", not "this story opts out".
  zdr: boolean("zdr").notNull().default(false),
  // doublePrecision, not real: Postgres `real` is 4-byte and would silently
  // round the slider values that SQLite stored at 8-byte precision.
  temperature: doublePrecision("temperature").notNull(),
  topP: doublePrecision("top_p").notNull(),
  maxTokens: integer("max_tokens").notNull(),
  // Input-token budget for composeContext, not an output cap. Defaulted in the
  // schema (not just in application code) so the generated ALTER TABLE
  // backfills every story that predates the column with the same 8192.
  contextWindow: integer("context_window").notNull().default(8192),
  // Percent of the free context the lorebook may claim. Defaulted in the schema
  // for the same reason context_window is: the generated ALTER TABLE backfills
  // every existing story with the share that used to be hard-coded, so nothing
  // composes differently the moment the column appears.
  loreBudget: integer("lore_budget").notNull().default(25),
  frequencyPenalty: doublePrecision("frequency_penalty").notNull(),
  presencePenalty: doublePrecision("presence_penalty").notNull(),
  // Whether new summary versions are written as the window slides. Defaulted
  // true in the schema so the generated ALTER TABLE turns it on for every story
  // that predates the column, which is the behaviour they already had.
  //
  // It governs WRITING only. A story with this off keeps sending whatever
  // version it already had: dropping the block would hand the model a sudden
  // continuity cliff, and the writer who switched this off asked to stop
  // spending money, not to forget what has happened so far.
  summarize: boolean("summarize").notNull().default(true),
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
    /**
     * The profile this take was generated under, by NAME rather than by id: a
     * retry may be fired under a profile the story does not follow, and the
     * record has to survive that profile being renamed or deleted. Null on user
     * passages, on rows written before this column existed, and on every take a
     * Custom story generated under its own columns.
     */
    genProfileName: text("gen_profile_name"),
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
 * The rolling story summary — one row per version, append-only.
 *
 * A story that outgrows its context window loses its opening prose from every
 * prompt; this is the recap that stands in for it. Rows are never updated and
 * never deleted: writing a new version is an INSERT, which is what makes
 * rewinding free. A rewind soft-deletes the passages an abandoned version was
 * written against, so that version's `through_entry_id` stops resolving and the
 * previous one takes over — with no model call, and with the undo restoring it
 * just as automatically. That property is the entire reason this is a table and
 * not a column on `stories`.
 *
 * Deliberately NOT joined to `generation_calls`: a recap is bookkeeping, not a
 * passage, and its ledger row already stands on its own with a NULL
 * story_entry_id.
 */
export const storyRecaps = pgTable(
  "story_recaps",
  {
    id: text("id").primaryKey(),
    storyId: text("story_id")
      .notNull()
      .references(() => stories.id, { onDelete: "cascade" }),
    /**
     * The last passage this version covers. The FK cascades because a deleted
     * story's recaps are meaningless, but the resolution query cares about
     * something the FK cannot express: whether that row is still LIVE. A
     * soft-deleted or deactivated take leaves the FK intact and the recap
     * unresolvable, which is exactly the behaviour rewind depends on.
     */
    throughEntryId: text("through_entry_id")
      .notNull()
      .references(() => storyEntries.id, { onDelete: "cascade" }),
    /**
     * That passage's position, denormalised so the resolver can order by
     * coverage without joining twice. Ordering by coverage rather than by
     * recency alone is insurance: the two agree while the recap only ever moves
     * forward, and coverage is the one that stays right if that ever changes.
     */
    throughPosition: integer("through_position").notNull(),
    text: text("text").notNull(),
    /** What wrote it, frozen — same philosophy as story_entries.gen*. */
    genModelId: text("gen_model_id"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    // Leading equality, then the two ORDER BY keys in the order the resolver
    // asks for them, so the newest-and-widest row is the index's first hit.
    index("story_recaps_story_coverage_idx").on(
      table.storyId,
      table.throughPosition,
      table.createdAt
    ),
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

/**
 * A named bundle of generation settings, global and shared by every story that
 * follows it. The model columns mirror the ones on `stories` exactly — same
 * names, same types — so neither side can drift from the other.
 *
 * The six slider columns are the exception, and are nullable here where they
 * are NOT NULL on a story: NULL is not a value but the absence of one, and
 * means the profile takes app_settings' default for that field. A story has no
 * such state — a Custom story's columns are always concrete.
 */
export const modelProfiles = pgTable("model_profiles", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  // Explicit rather than ordering by name or creation: the list is short and
  // hand-curated, and the writer's order is the order the switcher shows.
  sortOrder: integer("sort_order").notNull().default(0),
  modelId: text("model_id").notNull(),
  thinking: text("thinking").notNull().default("off").$type<ThinkingLevel>(),
  providerTag: text("provider_tag"),
  // NOT NULL where the sliders below are nullable, and deliberately: a policy
  // has no "no opinion" state. False is a profile that adds nothing to the
  // app-wide floor, not one that escapes it.
  zdr: boolean("zdr").notNull().default(false),
  temperature: doublePrecision("temperature"),
  topP: doublePrecision("top_p"),
  maxTokens: integer("max_tokens"),
  contextWindow: integer("context_window"),
  loreBudget: integer("lore_budget"),
  frequencyPenalty: doublePrecision("frequency_penalty"),
  presencePenalty: doublePrecision("presence_penalty"),
})

/** Single-row table; `id` is always 1. */
export const appSettings = pgTable("app_settings", {
  id: integer("id").primaryKey(),
  // Superseded by default_profile_id, which new stories read instead. Kept
  // (not dropped) so the migration is non-destructive and so the lazily seeded
  // "Default" profile has the writer's existing choice to seed from.
  defaultModelId: text("default_model_id").notNull(),
  defaultThinking: text("default_thinking")
    .notNull()
    .default("off")
    .$type<ThinkingLevel>(),
  // The profile new stories start from. NULL only before the lazy seed in
  // getAppSettings has run. Not a foreign key, matching stories.profile_id.
  defaultProfileId: text("default_profile_id"),
  // The summarizer's bundle: the same four columns a story and a profile state
  // for themselves, because it is the same kind of choice and the same picker
  // edits it. Kept here rather than as a model_profiles row because the
  // summarizer has no sliders worth inheriting — temperature and the penalties
  // are properties of the job, fixed in lib/generation/summarize.ts.
  //
  // NULL model_id means "the built-in default", which keeps improving; every
  // install that has never opened the picker follows it. The other three are
  // defaulted rather than nullable, matching model_profiles: Auto routing and
  // no thinking are concrete answers, not absent ones.
  summaryModelId: text("summary_model_id"),
  summaryThinking: text("summary_thinking")
    .notNull()
    .default("off")
    .$type<ThinkingLevel>(),
  summaryProviderTag: text("summary_provider_tag"),
  // A floor it adds to, never an escape from one: the STORY's policy still
  // binds, since it is the story's prose being sent. See summarizeOnce.
  summaryZdr: boolean("summary_zdr").notNull().default(false),
  // Sampling for the summarizer. Low by default because faithful compression
  // is not a creative task, but exposed like every other sampling value in the
  // app rather than pinned in code.
  summaryTemperature: doublePrecision("summary_temperature")
    .notNull()
    .default(0.3),
  // How long the recap should aim to be, in WORDS, or NULL to scale with the
  // story's own context window. Words rather than tokens because that is what
  // the summarizer is actually told, and a model follows a word count far
  // better than a token count.
  //
  // NULL is the better default and is worth keeping reachable: a fixed number
  // that suits a 128k window is most of an 8k one. It is the fixed value that
  // is the override here, not the other way round.
  summaryTargetWords: integer("summary_target_words"),
  // Hard output cap, or NULL to derive it from the target with enough slack
  // that an overshoot is not cut off mid-sentence. Distinct from the target: a
  // target is a request the model may miss, this is where the provider stops.
  summaryMaxTokens: integer("summary_max_tokens"),
  // The app-wide zero-data-retention floor. ORed into every story and profile
  // at read time rather than written into them, so switching it off restores
  // what each of them says for itself instead of leaving a fan-out behind.
  requireZdr: boolean("require_zdr").notNull().default(false),
  // The shared generation defaults every profile inherits per field. NOT NULL
  // with the app's own defaults on the column, so the single settings row is
  // never half-populated and a profile always has something to fall back to.
  defaultTemperature: doublePrecision("default_temperature")
    .notNull()
    .default(0.9),
  defaultTopP: doublePrecision("default_top_p").notNull().default(0.95),
  defaultMaxTokens: integer("default_max_tokens").notNull().default(1024),
  defaultContextWindow: integer("default_context_window")
    .notNull()
    .default(8192),
  defaultLoreBudget: integer("default_lore_budget").notNull().default(25),
  defaultFrequencyPenalty: doublePrecision("default_frequency_penalty")
    .notNull()
    .default(0.15),
  defaultPresencePenalty: doublePrecision("default_presence_penalty")
    .notNull()
    .default(0.1),
})

export type StoryRow = typeof stories.$inferSelect
export type StoryEntryRow = typeof storyEntries.$inferSelect
export type StoryRecapRow = typeof storyRecaps.$inferSelect
export type NewStoryRecapRow = typeof storyRecaps.$inferInsert
export type StoryOpRow = typeof storyOps.$inferSelect
export type GenerationCallRow = typeof generationCalls.$inferSelect
export type NewGenerationCallRow = typeof generationCalls.$inferInsert
export type LorebookEntryRow = typeof lorebookEntries.$inferSelect
export type AppSettingsRow = typeof appSettings.$inferSelect
export type ModelProfileRow = typeof modelProfiles.$inferSelect
export type NewModelProfileRow = typeof modelProfiles.$inferInsert
