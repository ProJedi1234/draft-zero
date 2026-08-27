// lib/types.ts — Single source of truth for the draft-zero domain contract.
// Implementation packages import from "@/lib/types" and MUST NOT redefine these.

/** Who produced a passage of story text. */
export type EntrySource = "user" | "generated"

/**
 * The two moves a writer can make. Both are typed in first person and stored
 * translated into second person; see lib/story/action-voice.ts.
 */
export type ActionKind = "say" | "do"

/**
 * What the composer is currently armed to do.
 *
 * "image" is not a third ActionKind: the two moves are things a CHARACTER does,
 * translated into second person and written into the manuscript as prose, and
 * an image is none of that. Keeping it out of ActionKind is what stops an
 * illustration ever being handed to translateAction or stored as a passage.
 */
export type ComposerMode = ActionKind | "image"

/** One contiguous block of prose in a story (a "passage"). */
export interface StoryEntry {
  id: string
  /**
   * Slot position in the manuscript's shared ordering sequence — the counter
   * StoryImage.position also draws from, which is what makes prose and
   * pictures sortable into one timeline. Optional only for fixtures that build
   * entries by hand; rows always carry it.
   */
  position?: number
  source: EntrySource
  /**
   * Prose text, paragraphs separated by "\n\n". For a player action this is
   * the *translated* second-person prose — the only version the canvas renders
   * and the only version composeContext sends to the model.
   */
  text: string
  /**
   * Which move produced this passage, or null when it is not a player action.
   * Null is the overwhelmingly common case and is not a defect: every
   * generated passage, every user passage written before Say/Do existed, and
   * the opening passage the NovelAI importer creates all predate or sidestep
   * the two moves, and there is nothing to backfill them with that would not
   * be a guess. Always null exactly when `inputText` is null.
   */
  actionKind: ActionKind | null
  /**
   * The writer's raw first-person input, kept verbatim beside the translation
   * so the transform stays inspectable and a future edit-in-place can re-run
   * it. Never shown in the manuscript and never sent to the model.
   */
  inputText: string | null
  /**
   * The slot this passage occupies. Alternative takes of the same passage all
   * share it; a passage that has never been retried is a slot of one.
   */
  variantGroupId: string
  /**
   * 0-based position of this take among the slot's takes, in variantIndex
   * order. Rendered as the left half of the switcher's "2 / 3" readout.
   */
  variantIndex: number
  /** How many takes the slot holds. 1 for a passage that has never been retried. */
  variantCount: number
  /**
   * True when the slot's takes were not all generated under the same profile —
   * which is the only time naming one is worth the pixels. A slot whose takes
   * agree says nothing, exactly as before retrying under a profile existed.
   */
  variantProfilesMixed: boolean
  /**
   * What produced this passage, or null when nothing did — every user passage,
   * and every generated passage written before provenance was recorded. Null is
   * "we do not know", not "default settings".
   */
  generation: EntryGeneration | null
  /**
   * What this take cost, in USD, as a decimal STRING straight out of Postgres —
   * never a float. Null means "we do not know": a user passage, a passage
   * written before the ledger existed, or a call OpenRouter declined to price.
   * Never render a null as "$0.00"; see formatUsd, which renders it as "—".
   */
  costUsd: string | null
  /** Tokens the model spent thinking, from the ledger. Null when unknown. */
  reasoningTokens: number | null
  /**
   * How the call that produced this take ended. "aborted" is a passage the
   * writer stopped mid-stream and kept; null is a take with no ledger row.
   */
  callStatus: SettledCallStatus | null
  /** ISO-8601 timestamp. */
  createdAt: string
}

/**
 * The settings a particular take was actually generated under, frozen at
 * generation time. Deliberately not the story's *current* settings: the whole
 * point of showing provenance beside a take is to explain why two takes of the
 * same passage read differently, which the live settings cannot do once the
 * writer has moved the temperature slider.
 */
export interface EntryGeneration {
  modelId: string
  thinking: ThinkingLevel
  temperature: number
  /**
   * The profile this take was generated under, or null when it was generated
   * under a story's own Custom columns — and on takes written before a retry
   * could name a profile at all. A name rather than an id, frozen like the
   * settings beside it: the profile it names may since have been renamed,
   * retuned or deleted, and this take is still the truth about what wrote it.
   */
  profileName: string | null
  /** Exact counts from the provider's final usage event, or null when it sent none. */
  promptTokens: number | null
  completionTokens: number | null
}

/**
 * Which move sent a generation request.
 *
 * "summarize" is the odd one and deliberately so: it is the only kind the
 * writer never asked for and never watches, and the only one that produces no
 * passage. It is in this union because the spend ledger is keyed by it and a
 * billed call that no aggregate can see is worse than one recorded oddly — see
 * REQUEST_KINDS in lib/actions/generation.ts, which keeps the kinds the client
 * is allowed to name separate from the ones that only the server raises.
 *
 * "illustrate-prompt" is a TEXT call like the others — it asks the story's own
 * model to describe the current scene as an image prompt. The picture that
 * prompt goes on to produce is billed separately and in a different currency
 * (per-image, not per-token), which is exactly why the two are distinct kinds
 * rather than one "image" bucket: summing them would add dollars-per-megapixel
 * to dollars-per-token and call the result a model's cost.
 */
export type GenerationRequestKind =
  | "generate"
  | "retry"
  | "continue"
  | "summarize"
  | "illustrate-prompt"
  /** The picture itself. Billed per image or per megapixel, never per token. */
  | "illustrate"

/**
 * A ledger row's lifecycle. The row is written as "streaming" before anything
 * is known about the outcome, which is what guarantees a stopped or crashed
 * call still leaves a trace. Every aggregate excludes "streaming" — a call in
 * flight has no cost yet and a crashed process would otherwise leave one
 * pending forever.
 */
export type GenerationCallStatus = "streaming" | "ok" | "aborted" | "error"

/** A call that has resolved — everything a reader ever sums or displays. */
export type SettledCallStatus = Exclude<GenerationCallStatus, "streaming">

/**
 * Where a cost figure came from. "stream" is the final chunk's own number;
 * "reconciled" is OpenRouter's /generation record, which is allowed to
 * overwrite a streamed value but is never overwritten by one.
 */
export type CostSource = "stream" | "reconciled"

/**
 * Everything the per-story cost surfaces need, in one read.
 *
 * Every USD figure is a decimal string summed in SQL. `unpricedCalls` is the
 * honesty column: it is what lets a total be shown as "$0.42+" with a footnote
 * instead of quietly presenting an undercount as exact.
 */
export interface StoryCostProfile {
  totalUsd: string
  calls: number
  /** Settled calls with no price at all — the "+" in "$0.42+". */
  unpricedCalls: number
  /** Calls the writer stopped mid-stream. Billed, and usually unpriced. */
  abortedCalls: number
  promptTokens: number
  completionTokens: number
  /** Spend by model, descending. */
  perModel: ModelShareRow[]
  /** Spend per surviving passage, in manuscript order — the sparkline's data. */
  perEntry: EntrySpendRow[]
}

export interface ModelShareRow {
  modelId: string
  costUsd: string
  calls: number
}

export interface EntrySpendRow {
  entryId: string
  position: number
  costUsd: string | null
}

/** The "where am I right now" numbers, all UTC-day bucketed. */
export interface GlobalCostSummary {
  todayUsd: string
  weekUsd: string
  allTimeUsd: string
  /**
   * The slice of each window spent on pictures ("illustrate" calls). A subset
   * of the figure beside it, never an addition — the derivation call that
   * described the scene is token-billed prose and stays on the text side.
   */
  todayImageUsd: string
  weekImageUsd: string
  allTimeImageUsd: string
  /** All-time count of settled calls with no price. */
  unpricedCalls: number
  /**
   * Unpriced calls inside each window, so a figure is only marked as a floor
   * when its OWN window contains one. Marking "today" with a "+" because of an
   * unpriced call from last month is not a caveat, it is a wrong caveat.
   */
  todayUnpricedCalls: number
  weekUnpricedCalls: number
  /** Unpriced "illustrate" calls per window, so the picture line floors too. */
  todayImageUnpricedCalls: number
  weekImageUnpricedCalls: number
  allTimeImageUnpricedCalls: number
}

/** One bucket of the spend-over-time series. `day` is a UTC "YYYY-MM-DD". */
export interface SpendDay {
  day: string
  costUsd: string
  /** The slice of `costUsd` that bought pictures. A subset, never summed in. */
  imageUsd: string
  calls: number
}

export interface StorySpendRow {
  /** Null once the story has been deleted; the ledger row outlives it. */
  storyId: string | null
  /** The live title, else the denormalised one, else "Deleted story". */
  title: string
  isDeleted: boolean
  costUsd: string
  calls: number
}

export interface ModelSpendRow {
  modelId: string
  costUsd: string
  calls: number
  promptTokens: number
  completionTokens: number
}

/**
 * Per-model spend for image models, in image units: a count of pictures and
 * an average price per picture, never prompt/completion tokens — the columns
 * a text model's row shows would read 0/0 here and mean nothing.
 */
export interface ImageModelSpendRow {
  modelId: string
  costUsd: string
  /** Settled "illustrate" calls — one per picture asked for, kept or not. */
  images: number
  /** avg over PRICED pictures only, `null` when none were. Formatted, never summed. */
  avgUsd: string | null
  /** Pictures with no price, so the row's total reads as the floor it is. */
  unpricedImages: number
}

/**
 * Reasoning efforts OpenRouter accepts, lowest first. Sent as
 * `reasoning.effort`; the catalog says per model which ones are allowed.
 */
export const REASONING_EFFORTS = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number]

/** What a story asks of a thinking model: an effort, or no thinking at all. */
export type ThinkingLevel = ReasoningEffort | "off"

/** Writer-facing labels for the thinking dropdown. */
export const THINKING_LEVEL_LABELS: Record<ThinkingLevel, string> = {
  off: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
}

/**
 * Selectable input-context sizes, ascending. A ladder rather than a free range
 * because the control is a slider and every intermediate value would be a lie:
 * the writer thinks in "how much story does the model see", not in single
 * tokens. The 6k–16k band is where the interesting trade-offs live, so it is
 * filled in; above it only the powers of two are worth offering. The floor is
 * 2k because the system prompt alone is most of a 1k window — a stop that can
 * carry the instructions but no story is not a setting, it is a bug report.
 */
export const CONTEXT_WINDOWS = [
  2048, 4096, 6144, 8192, 10240, 12288, 16384, 32768, 65536, 131072,
] as const

export type ContextWindow = (typeof CONTEXT_WINDOWS)[number]

/**
 * Compact readouts for the slider, index-aligned with CONTEXT_WINDOWS. Written
 * out rather than computed so the lowercase "k" and the exact rounding
 * ("128k", not the 131K that lib/format.ts's formatContextLength produces for
 * model catalog entries) stay stable and reviewable.
 */
export const CONTEXT_WINDOW_LABELS = [
  "2k",
  "4k",
  "6k",
  "8k",
  "10k",
  "12k",
  "16k",
  "32k",
  "64k",
  "128k",
] as const

/** The window new stories start from, and what pre-column rows were backfilled with. */
export const DEFAULT_CONTEXT_WINDOW = 8192

/**
 * The compact readout for a ladder stop. Every surface that prints a *selected*
 * window goes through here rather than lib/format.ts's formatContextLength —
 * the slider and the context meter sit centimetres apart in the same panel, and
 * "128k" above "131K" reads as two different settings. formatContextLength
 * stays the right call for model catalog entries, which are not ladder stops.
 */
export function contextWindowLabel(value: number): string {
  const index = (CONTEXT_WINDOWS as readonly number[]).indexOf(value)
  return index === -1 ? `${value}` : CONTEXT_WINDOW_LABELS[index]
}

/** True when `value` is one of the ladder stops — the server-side write guard. */
export function isContextWindow(value: number): value is ContextWindow {
  return (CONTEXT_WINDOWS as readonly number[]).includes(value)
}

/**
 * Bounds for the lore budget share, as a percentage of the free context.
 *
 * The ceiling is 50 rather than 100 deliberately: prose is what the model
 * continues from, and a lorebook allowed to claim the whole window could starve
 * the manuscript out of its own prompt. A writer who wants more than half the
 * context spent on lore wants a bigger context, not a bigger share.
 */
export const LORE_BUDGET_MIN = 0
export const LORE_BUDGET_MAX = 50
export const LORE_BUDGET_STEP = 5
/** The share lore claimed back when it was a hard-coded constant. */
export const DEFAULT_LORE_BUDGET = 25

/** Clamps to the slider's own range and step — the server-side write guard. */
export function clampLoreBudget(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_LORE_BUDGET
  const stepped = Math.round(value / LORE_BUDGET_STEP) * LORE_BUDGET_STEP
  return Math.min(LORE_BUDGET_MAX, Math.max(LORE_BUDGET_MIN, stepped))
}

/**
 * Largest ladder stop the model can actually accept.
 *
 * `contextLength` of 0 means "model unknown to the catalog" — we cannot prove
 * the window is too big, so we don't clamp at all rather than silently
 * shrinking the writer's setting. If even the smallest stop exceeds the
 * model's window we still return that smallest stop: there is nothing lower to
 * offer, and composeContext degrades gracefully when the budget is tiny.
 */
export function clampContextWindow(
  value: number,
  contextLength: number
): number {
  if (contextLength <= 0) return value
  let allowed: number = CONTEXT_WINDOWS[0]
  for (const step of CONTEXT_WINDOWS) {
    if (step > contextLength) break
    allowed = step
  }
  return Math.min(value, allowed)
}

/**
 * The six sampling/budget knobs, split out from the model identity because they
 * are the half a profile may leave unset: one global set of them lives in
 * app settings, and a profile overrides only what it cares about.
 */
export interface GenerationDefaults {
  /** Range 0–2. */
  temperature: number
  /** Range 0–1. */
  topP: number
  /**
   * Token budget for the assembled INPUT context — the ceiling composeContext
   * (lib/generation/context.ts) trims memory, lore and story prose down to.
   *
   * The only token budget a writer sets. There is deliberately no OUTPUT
   * counterpart: passage length is the system prompt's job ("write ONE
   * paragraph, roughly 40 to 100 words"), and a max_tokens ceiling on top of
   * that was never a length control — it was a truncation that fired only when
   * the model overran, mid-sentence, and on a reasoning model fired against the
   * thinking rather than the prose and returned nothing at all.
   *
   * Always one of CONTEXT_WINDOWS.
   */
  contextWindow: number
  /**
   * Percentage (0–50) of the free context budget the lorebook may claim before
   * story prose takes the rest. Whatever lore does not spend flows back to
   * prose, so this is a ceiling rather than a reservation.
   *
   * A setting rather than the constant it used to be because the right answer
   * is per-story: a dense worldbuilding lorebook wants far more of the window
   * than a character piece whose lore is three entries long, and the writer is
   * the only one who knows which they are writing.
   */
  loreBudget: number
  /** Range -2–2. */
  frequencyPenalty: number
  /** Range -2–2. */
  presencePenalty: number
}

/** The slider fields, in the order every editor lists them. */
export const GENERATION_DEFAULT_KEYS = [
  "temperature",
  "topP",
  "contextWindow",
  "loreBudget",
  "frequencyPenalty",
  "presencePenalty",
] as const satisfies readonly (keyof GenerationDefaults)[]

/** Generation parameters attached to a story (OpenRouter-shaped). */
export interface GenerationSettings extends GenerationDefaults {
  /** OpenRouter model id, e.g. "~anthropic/claude-sonnet-latest". */
  modelId: string
  /**
   * How hard the model should think before writing. Always "off" for a new
   * story — thinking is opt-in, and non-thinking models ignore it entirely.
   */
  thinking: ThinkingLevel
  /**
   * Which upstream endpoint serves the model, as an OpenRouter endpoint tag
   * ("deepinfra/turbo", "groq"). NULL is Auto — OpenRouter's own routing — and
   * is what every new story starts on. Model-specific by construction: the tag
   * only means anything for the model whose endpoint list it came from, so
   * changing models resets it (see the inspector's handleModelChange).
   */
  providerTag: string | null
  /**
   * Route only through endpoints that retain nothing — OpenRouter's `zdr`
   * provider preference.
   *
   * A floor rather than a switch: the app-wide policy in AppSettings.requireZdr
   * ORs into this on the way out of lib/generation/resolve.ts, and OpenRouter
   * ORs its own account and guardrail settings on top of that. Turning it on
   * anywhere turns it on; nothing here can turn it off, which is what makes a
   * data policy a policy instead of a suggestion.
   */
  zdr: boolean
}

/**
 * Everything the summarizer runs under.
 *
 * The model half is GenerationIdentity with a nullable model, because "not
 * chosen" is a real state here and is not the same as any particular model: it
 * follows the app's built-in default as that changes.
 *
 * The two nullable numbers work the same way. NULL is not "unset pending a
 * value" but a live rule — scale with the story's window, and leave slack over
 * the target — and it is deliberately the DEFAULT rather than the override,
 * because a fixed number that suits a 128k window is most of an 8k one.
 */
export type SummarizerSettings = Omit<GenerationIdentity, "modelId"> & {
  modelId: string | null
  temperature: number
  /** Words the recap should aim for, or null to scale with the story's window. */
  targetWords: number | null
  /** Hard output cap, or null to derive it from the target. */
  maxTokens: number | null
}

/**
 * Everything the atmosphere picker runs under — the micro-call that reads the
 * tail of a manuscript and answers with a tint name, or with "keep".
 *
 * The summarizer's bundle without its two lengths, because there is nothing to
 * scale: the answer is one word, and the only cap worth having is the small
 * fixed one the runner sets to leave a reasoning model room to think. Same
 * nullable model for the same reason — "not chosen" follows the app's built-in
 * default as that changes.
 */
export type AtmosphereSettings = Omit<GenerationIdentity, "modelId"> & {
  modelId: string | null
  temperature: number
}

/** The model half of a bundle — what a profile always states for itself. */
export type GenerationIdentity = Pick<
  GenerationSettings,
  "modelId" | "thinking" | "providerTag" | "zdr"
>

/**
 * The part of an identity a one-line summary prints. Narrower than
 * GenerationIdentity because the data policy is not a word in that line — it is
 * a mark beside it, and the surfaces that show it hold it separately.
 */
export type GenerationSummaryIdentity = Omit<GenerationIdentity, "zdr">

/**
 * What a story or a profile is resolved against. One object rather than two
 * arguments because both halves come out of the single app_settings row, and
 * every resolver needs the pair: the sliders an unset field falls back to, and
 * the retention floor that no bundle can fall below.
 */
export interface GenerationBaseline {
  defaults: GenerationDefaults
  requireZdr: boolean
}

/**
 * The six sliders as a profile stores them: null is not a value but the absence
 * of one, meaning "whatever the global default currently says".
 */
export type GenerationOverrides = {
  [K in keyof GenerationDefaults]: GenerationDefaults[K] | null
}

/**
 * What a profile holds. The identity is required — a profile that named no
 * model would not be a profile — while every slider is an override.
 */
export type ProfileSettings = GenerationIdentity & GenerationOverrides

/**
 * A named, global bundle of generation settings. A story either follows one —
 * and then tracks every later edit to it — or is Custom; there is no third,
 * "followed but edited" state to detect.
 *
 * `settings` is not the effective bundle: its sliders may be null, meaning the
 * profile defers to AppSettings.defaultGeneration. Run it through
 * resolveProfileSettings to get something a story can generate under.
 */
export interface ModelProfile {
  id: string
  name: string
  /** Position in the switcher and the settings list; ascending. */
  sortOrder: number
  settings: ProfileSettings
}

export interface Story {
  id: string
  title: string
  /** One-to-two sentence pitch shown in the library and inspector. */
  description: string
  genre: string
  /** ISO-8601. */
  createdAt: string
  /** ISO-8601. */
  updatedAt: string
  /** Precomputed for static scaffolding — display as-is, do not recompute. */
  wordCount: number
  /**
   * The manuscript, or a tail window of it. When windowed, the fields below
   * describe what precedes entries[0]; all absent (or 0/false) means the whole
   * manuscript is here, which is what every fixture and mock builds.
   */
  entries: StoryEntry[]
  /** Live active entries before entries[0]. Preserves composeContext's seed. */
  entriesBefore?: number
  /**
   * Manuscript chars (UTF-16 units, as manuscriptWithOffsets joins them —
   * markers and separators included, plus the separator that precedes
   * entries[0]) before the window. Preserves the trim anchor: the quantized
   * window start is an absolute offset, and absolute offsets survive windowing
   * as long as the length of what was dropped is known.
   */
  charsBefore?: number
  /** True when older live entries exist beyond this window. */
  hasMoreBefore?: boolean
  /** entries[0]'s slot position — the cursor for paging older passages in. */
  windowStartPosition?: number
  /** min/max createdAt over ALL live generated entries, windowed or not. */
  generatedSpan?: { firstIso: string; lastIso: string } | null
  /**
   * Illustrations, keyed by the passage SLOT they hang under. Only the active
   * take of each image slot is present, exactly as `entries` holds only the
   * active take of each passage slot.
   */
  images: StoryImage[]
  /**
   * The profile this story follows, or null for Custom. When set, `settings`
   * below is the profile's; the story's own columns stay untouched underneath,
   * holding the custom settings it will return to.
   */
  profileId: string | null
  /** Effective settings: the followed profile's, or the story's own. */
  settings: GenerationSettings
  /** NovelAI-style memory: always included at the top of context. */
  memory: string
  /** Author's note: injected near the most recent words. */
  authorsNote: string
  /**
   * Whether new versions of the summary are written as the window slides.
   *
   * Writing only. A story with this off keeps SENDING the version it already
   * had — see the column comment. False is "stop spending money on this", not
   * "forget what has happened".
   */
  summarize: boolean
  /**
   * The rolling recap of prose that has fallen out of the context window, or ""
   * when nothing has (a short story) or nothing has been written yet.
   *
   * Resolved at read time from `story_recaps` — the story holds no summary
   * column, because which version is in force is a question about which
   * passages are still live, not a fact any one row can store. See
   * resolveStoryRecap.
   */
  summary: string
  /** Per-story narrator prompt override; null uses DEFAULT_SYSTEM_PROMPT. */
  systemPrompt: string | null
  /**
   * The story's atmosphere: a hue in degrees, or null for untinted.
   *
   * Only a hue — the palette's lightness and per-token chroma budgets belong to
   * the colour scheme, so one stored number renders correctly as coloured
   * shadow in dark and as tinted paper in light. See globals.css.
   */
  tintHue: number | null
  /** How far toward that hue the palette travels, 0..1. Ignored when untinted. */
  tintStrength: number
  /**
   * Whether the model gets to choose the tint as the story moves.
   *
   * On by default, and turned off by touching a swatch: a hue chosen by hand is
   * a decision, and something that repainted the room the writer just painted
   * would be a bug however good its taste. Picking Auto again hands it back.
   */
  tintAuto: boolean
  /**
   * Which image model this story draws with, or null to follow the catalog's
   * first entry. Deliberately NOT part of a model profile: profiles bundle the
   * settings that shape prose, and there are few enough image models that a
   * named bundle around one would be ceremony rather than a feature.
   */
  imageModelId: string | null
  /** LorebookEntry ids currently "triggered" for this story (mocked). */
  activeLorebookEntryIds: string[]
  canUndo: boolean
  canRedo: boolean
  /**
   * What ⌘Z would reverse, for the button's tooltip — "Retry", "Your turn".
   * Null when there is nothing to undo. Carried on the story rather than
   * fetched by the composer because the composer already re-renders on every
   * story change, and a second round trip would let the label lag the button.
   */
  undoSummary: string | null
  /** What ⌘⇧Z would reapply. Null when the redo tail is empty. */
  redoSummary: string | null
}

/**
 * What the undo/redo buttons need to know, read from the story's cursor. Kept
 * as its own shape (rather than four loose fields) because lib/db/journal.ts
 * computes all four in one query and `toStory` passes them straight through.
 */
export interface HistoryState {
  canUndo: boolean
  canRedo: boolean
  undoSummary: string | null
  redoSummary: string | null
}

/**
 * One stored version of a story's rolling summary.
 *
 * `throughEntryId` is what makes a version resolvable or not: it names the last
 * passage the recap covers, and a version whose passage has been rewound away
 * simply stops being eligible. Nothing here is ever mutated.
 */
export interface StoryRecap {
  id: string
  text: string
  /** The last passage this version covers. */
  throughEntryId: string
  /** That passage's position — the coverage key the resolver orders by. */
  throughPosition: number
  /** ISO-8601. */
  createdAt: string
}

/** Story metadata without entries — sidebar/library surface. */
export interface StorySummary {
  id: string
  title: string
  description: string
  genre: string
  createdAt: string
  updatedAt: string
  /** Only the library grid pays for this; the sidebar list omits it. */
  wordCount?: number
  /** The story's atmosphere, so a card can wear it. See Story.tintHue. */
  tintHue: number | null
  tintStrength: number
}

/**
 * Narrative roles, with one deliberate exception. "class" is the odd member:
 * the others describe what a thing *is* in any story, while a class is an
 * archetype borrowed from game-shaped fiction. It earns its place empirically —
 * a third of a real imported lorebook was classes, and a category that leaves
 * a third of the entries in "concept" is not sorting anything.
 *
 * The precedent it sets is known and accepted: the next genre will want "skill"
 * or "bloodline", and the answer to *that* is per-story categories, not a
 * longer union. This is a text column, not a Postgres enum, so a value costs no
 * migration — and nothing in lib/generation reads the category at all, so it
 * cannot change what any model sees.
 */
export type LorebookCategory =
  "character" | "class" | "location" | "faction" | "item" | "event" | "concept"

export interface LorebookEntry {
  id: string
  /** Owning story. Lore is scoped per story — there is no global lorebook. */
  storyId: string
  name: string
  category: LorebookCategory
  /** Trigger keywords that activate this entry when seen in recent story text. */
  keys: string[]
  /** Lore text injected into context when triggered. */
  content: string
  enabled: boolean
  /** If true, always in context regardless of trigger keys. */
  alwaysActive: boolean
  /** 0–100; higher inserts earlier and survives context trimming longer. */
  priority: number
  /** ISO-8601. */
  createdAt: string
  /** ISO-8601. */
  updatedAt: string
}

/** Input for creating a lorebook entry. The owning story is passed separately. */
export type NewLorebookEntry = Omit<
  LorebookEntry,
  "id" | "storyId" | "createdAt" | "updatedAt"
>

/** App-level settings (settings page). */
export interface AppSettings {
  /** @deprecated Superseded by `defaultProfileId`; only the seed still reads it. */
  defaultModelId: string
  /** @deprecated Superseded by `defaultProfileId`; only the seed still reads it. */
  defaultThinking: ThinkingLevel
  /**
   * The profile new stories start from. Null only in the window before
   * getAppSettings has seeded one, which it does on the first read.
   */
  defaultProfileId: string | null
  /**
   * The sampling and budget values every profile falls back to, field by field.
   * Shared rather than copied: the writer tunes temperature once and every
   * profile that never disagreed with it moves.
   */
  defaultGeneration: GenerationDefaults
  /**
   * What writes the rolling story summaries — the same model/provider/thinking/
   * policy bundle a profile states for itself, edited by the same picker.
   *
   * App-wide rather than per story: compressing prose without losing names is
   * one job with one right answer, and it is emphatically not the model the
   * writer picked to write their book. `modelId` is null until the picker is
   * opened, meaning "the built-in default", which keeps improving.
   */
  summarizer: SummarizerSettings
  /**
   * What picks a story's tint once the scene has moved — the same bundle,
   * app-wide for the same reason: naming the mood of a passage is one job, and
   * the writer should not pay their prose model's rate to have it done.
   */
  atmosphere: AtmosphereSettings
  /**
   * Zero data retention for the whole app: every story, every profile, every
   * generation.
   *
   * Not a default a profile falls back to but a floor it adds to, which is why
   * it sits here rather than in defaultGeneration. Turning it on cannot be
   * undone one profile at a time — a retention policy that a bundle could opt
   * out of would only be a suggestion — and turning it off gives every profile
   * back whatever it says for itself.
   */
  requireZdr: boolean
  /**
   * The image model stories draw with unless they chose their own — the one
   * default images have, since they deliberately sit outside model profiles.
   * Null means "the catalog's first eligible entry", which is the seed state
   * rather than a frozen id that would outlive the catalog that suggested it.
   */
  defaultImageModelId: string | null
  /**
   * The derivation call's context budget, in tokens. App-wide because it is a
   * property of how the image feature works, not of any one manuscript — see
   * the rationale where it is spent, in app/api/image-prompt/route.ts.
   */
  imageContextTokens: number
}

/**
 * The budgets the image-context select offers. A short ladder rather than the
 * prose window's, because this call's ceiling is dilution, not recall — past a
 * few thousand tokens the extra manuscript pulls the derived scene toward the
 * story's average. See app/api/image-prompt/route.ts.
 */
export const IMAGE_CONTEXT_OPTIONS = [1024, 2048, 4096, 8192, 16384] as const

/** Uniform server-action result. Actions never throw for expected failures. */
export type ActionResult<T = null> =
  { ok: true; data: T } | { ok: false; error: string }

/**
 * The frames an illustration may be asked for, in the order the aspect button
 * cycles them.
 *
 * A ladder rather than a free field for the same reason CONTEXT_WINDOWS is one:
 * the control is a single icon button, and every value it can land on has to be
 * a frame a writer would actually choose. Landscape first because a manuscript
 * column is wider than it is tall, so 16:9 is the shape that reads as
 * "illustration" rather than "inserted photo".
 *
 * OpenRouter's per-model capability descriptors advertise which of these a
 * given image model accepts; the cycle filters against that list, so this is
 * the superset we know how to render, not a promise every model honours it.
 */
export const IMAGE_ASPECT_RATIOS = ["16:9", "1:1", "9:16"] as const

export type ImageAspectRatio = (typeof IMAGE_ASPECT_RATIOS)[number]

/** width / height for an aspect ratio — what the placeholder reserves. */
export function aspectRatioValue(ratio: ImageAspectRatio): number {
  const [w, h] = ratio.split(":").map(Number)
  return w / h
}

/**
 * One illustration: a beat in the story, not an ornament on a passage.
 *
 * Positioned in the same sequence as passages rather than attached to one, so
 * asking for a picture is a move the writer makes at the end of the manuscript
 * — the same place every other move is made — and a picture is never orphaned
 * by an edit to prose that happens to sit above it.
 *
 * Takes work the same way passages' do: retrying an illustration inserts a
 * sibling into `imageGroupId` rather than overwriting, and `imageIndex` /
 * `imageCount` drive the same "‹ 2 / 3 ›" switcher.
 */
export interface StoryImage {
  id: string
  /**
   * Where this sits in the manuscript. Shares a counter with StoryEntry.position,
   * so passages and pictures merge into one ordered timeline.
   */
  position: number
  /** This image's own take slot; every alternative take shares it. */
  imageGroupId: string
  /** 0-based position among the slot's takes, in imageIndex order. */
  imageIndex: number
  /** How many takes the slot holds. 1 for an illustration never retried. */
  imageCount: number
  /**
   * The scene prompt that was sent, WITHOUT the image profile's style line —
   * the writer edits scene, the profile owns art direction, and mixing the two
   * back together here would make a re-open of the editor show them words they
   * never typed.
   */
  prompt: string
  /**
   * What derivation produced before the writer touched it, or null when the
   * prompt was never derived. Kept as provenance: it is the only way to tell a
   * prompt the writer wrote from one they accepted.
   */
  derivedPrompt: string | null
  modelId: string
  aspectRatio: ImageAspectRatio
  /** Drives the mock's composition; sent as `seed` to a real provider. */
  seed: number
  /** "image/svg+xml" offline, "image/png" from a real provider. */
  mediaType: string
  /**
   * What this take cost, USD, as a decimal string. Null means "we do not
   * know" — which is every image the offline mock produced, since nothing was
   * billed and a number here would be indistinguishable from a record.
   */
  costUsd: string | null
  /** How the draw that produced this take ended. Null when there is no ledger row. */
  callStatus: SettledCallStatus | null
  /**
   * What the whole slot has cost — every draw, including the takes no longer
   * showing. Retrying spends again, and this is the figure that says so.
   */
  slotCostUsd: string | null
  /** Settled draws of this slot with no price, so a total can be marked a floor. */
  slotUnpricedCalls: number
  createdAt: string
}

/**
 * One tile on the gallery's photo wall: an illustration plus just enough of its
 * story to caption and group it. Flat rather than nested under a story because
 * the wall's default order is cross-story by recency, and takes/positions are
 * the manuscript's concern — the gallery only ever shows what the manuscript
 * shows, so slot mechanics never reach it.
 */
export interface GalleryImage {
  id: string
  prompt: string
  aspectRatio: ImageAspectRatio
  mediaType: string
  modelId: string
  createdAt: string
  storyId: string
  storyTitle: string
  /** The story's tint, so a grouped section can wear it. See Story.tintHue. */
  tintHue: number | null
  tintStrength: number
}

/**
 * An entry from OpenRouter's image catalog (GET /api/v1/images/models).
 *
 * Much thinner than OpenRouterModel because almost nothing carries over: an
 * image model has no context window, no reasoning, and no prompt/completion
 * token split.
 *
 * Price is NOT here, and that is the catalog's doing rather than a choice: the
 * list endpoint carries no pricing at all — each entry's `endpoints` field is a
 * URL to fetch, and the cost per image lives behind it. Pricing one model costs
 * one request, so it is fetched for the SELECTED model only; see
 * getImageModelPrice.
 */
export interface OpenRouterImageModel {
  id: string
  name: string
  provider: string
  /**
   * At least one of this model's endpoints retains nothing, per OpenRouter's
   * global ZDR list — the same source the text catalog's flag comes from. False
   * is also what an unconfigured or failed lookup yields, which is the safe
   * direction: the picker greys the row rather than promising retention-free
   * routing the app could not verify.
   */
  zdr: boolean
}

/** A model's reasoning support, straight from the OpenRouter catalog. */
export interface ModelReasoning {
  /** Efforts this model accepts, lowest first. Never empty, never has "off". */
  efforts: ReasoningEffort[]
  /**
   * The model always thinks: "off" can't be honoured, so it falls back to the
   * provider's own default rather than being sent as `effort: "none"`.
   */
  mandatory: boolean
}

/** Minimal stub of an OpenRouter model listing. */
export interface OpenRouterModel {
  /** e.g. "anthropic/claude-sonnet-5" */
  id: string
  /** Display name, e.g. "Claude Sonnet 5". */
  name: string
  /** Provider display name, e.g. "Anthropic". */
  provider: string
  contextLength: number
  /**
   * Most tokens this model will generate in one reply, from the catalog's
   * `top_provider`. Null when OpenRouter does not publish one (~12% of the
   * catalog), which is not a small limit but an unknown one.
   *
   * Displayed, never sent: omitting `max_tokens` already gets the model's own
   * ceiling, and sending this number instead could exceed what a PINNED
   * endpoint serves, turning a routing choice into a rejected request.
   */
  maxCompletionTokens: number | null
  /** Display strings, USD per 1M tokens, e.g. { prompt: "$3.00", completion: "$15.00" }. */
  pricing: {
    prompt: string
    completion: string
  }
  /** Reasoning support, or null when the model cannot think. */
  reasoning: ModelReasoning | null
  /**
   * At least one endpoint serving this model retains nothing, so it can be
   * generated under a zero-data-retention policy at all. False makes the model
   * unpickable while such a policy is in force — every request for it would be
   * refused before it reached a provider.
   *
   * Resolved through the alias for a router model: the alias serves nothing
   * itself, so what answers for it is whatever sits behind it.
   */
  zdr: boolean
  /**
   * For a "~lab/family-latest" router alias, the id of the concrete model it
   * currently redirects to, e.g. "anthropic/claude-sonnet-5". Absent on ordinary
   * models. An alias serves nothing itself, so this is the only id that has an
   * endpoint list — and the endpoints it names are the ones a request against
   * the alias will actually be routed through.
   */
  aliasTarget?: string
}

/**
 * One upstream endpoint that serves a model — a single row of the provider
 * picker. Every field is per-endpoint, not per-model: two providers hosting the
 * same weights routinely differ in price, window and speed, which is the whole
 * reason the picker exists.
 */
export interface ModelEndpoint {
  /**
   * OpenRouter endpoint tag — the value `provider.only` accepts, either a bare
   * provider slug ("groq") or a slug with a variant suffix ("deepinfra/turbo").
   * Unique within a model's endpoint list, so it doubles as the row key.
   */
  tag: string
  /** Provider display name, e.g. "DeepInfra". */
  providerName: string
  contextLength: number
  /** Display strings, USD per 1M tokens — same shape as OpenRouterModel.pricing. */
  pricing: {
    prompt: string
    completion: string
  }
  /**
   * Median output tokens/sec over the last 30 minutes, or null when OpenRouter
   * has no recent measurement (a cold or brand-new endpoint). Null is rendered
   * as an em dash rather than a zero — "not measured" is not "slow".
   */
  throughput: number | null
  /** Fraction 0–1 of successful requests over the last day, or null when unmeasured. */
  uptime: number | null
  /** Weight quantization, e.g. "fp8". Null when the provider doesn't say. */
  quantization: string | null
  /**
   * The provider keeps nothing of a request served here — OpenRouter's own ZDR
   * list says so, endpoint by endpoint. Two endpoints of the same provider
   * routinely differ ("xai" retains, "xai/zdr" does not), so this is per-tag
   * and never inferred from the provider name.
   */
  zdr: boolean
}

/**
 * The endpoint a stored `providerTag` refers to, or null for Auto and for a tag
 * that has since left the model's endpoint list. Callers treat null the same
 * way either side of that distinction — Auto and "the provider you picked is
 * gone" both mean "let OpenRouter route" — so the two are not separated here.
 */
export function endpointForTag(
  endpoints: ModelEndpoint[],
  tag: string | null
): ModelEndpoint | null {
  if (tag === null) return null
  return endpoints.find((e) => e.tag === tag) ?? null
}

/**
 * The endpoint a pin actually lands on, or null for "let OpenRouter route".
 *
 * Two ways to get null beyond plain Auto, and callers treat them alike: a tag
 * that has left the model's endpoint list, and — under a zero-data-retention
 * policy — a tag that names an endpoint which retains prompts. Both mean the
 * writer's pin cannot be honoured, and both are the pin's problem rather than
 * the generation's: OpenRouter refuses the second pair outright, so keeping it
 * would cost the writer the continuation as well as the provider.
 */
export function routableEndpointForTag(
  endpoints: ModelEndpoint[],
  tag: string | null,
  zdr: boolean
): ModelEndpoint | null {
  const endpoint = endpointForTag(endpoints, tag)
  if (!endpoint) return null
  return !zdr || endpoint.zdr ? endpoint : null
}

/** Where OpenRouter keeps the account-wide data policy this app can only read through failures. */
export const OPENROUTER_PRIVACY_URL = "https://openrouter.ai/settings/privacy"

/**
 * What this app has managed to learn about the OpenRouter account's own
 * retention policy, for one model group. "unknown" is the honest and common
 * answer — there is no API for it, only a probe (lib/generation/zdr.ts) that
 * can come back inconclusive — and every control reads it as "not locked",
 * leaving the writer in charge.
 */
export type AccountZdrPolicy = "enforced" | "not-enforced" | "unknown"

/**
 * OpenRouter's own five model groups. Its privacy settings carry one
 * zero-data-retention toggle per group, not one for the account, and real
 * accounts genuinely differ across them — Anthropic and OpenAI locked down
 * while Google and xAI are not is a normal state, not a misconfiguration.
 *
 * So this app cannot hold a single answer about "the account" either. Every
 * question about enforcement is a question about one group, and the group comes
 * from the model.
 */
export const ZDR_GROUPS = [
  "anthropic",
  "openai",
  "google",
  "xai",
  "other",
] as const
export type ZdrGroup = (typeof ZDR_GROUPS)[number]

/** Display names for the groups, in the order ZDR_GROUPS lists them. */
export const ZDR_GROUP_LABELS: Record<ZdrGroup, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  xai: "xAI",
  other: "other providers",
}

/** Per-group verdicts — what a surface with no single model in front of it reads. */
export type AccountZdrPolicies = Record<ZdrGroup, AccountZdrPolicy>

/**
 * Which group a model's retention policy is decided by: its author, with
 * everything outside the four frontier labs landing in "other".
 *
 * The alias prefix is stripped first — "~anthropic/claude-sonnet-latest" is an
 * Anthropic model however it is spelled — and OpenRouter's own slug for xAI is
 * "x-ai", which is the one place the author and the group name differ.
 */
export function zdrGroupForModel(modelId: string): ZdrGroup {
  const author = modelId.replace(/^~/, "").split("/")[0]
  switch (author) {
    case "anthropic":
      return "anthropic"
    case "openai":
      return "openai"
    case "google":
      return "google"
    case "x-ai":
      return "xai"
    default:
      return "other"
  }
}

/**
 * The endpoints a bundle may actually be routed to, and the ones its data
 * policy rules out. Under `zdr: false` nothing is ruled out and `blocked` is
 * empty — the picker renders the same two lists either way and simply has
 * nothing to grey out.
 */
export function partitionByZdr(
  endpoints: ModelEndpoint[],
  zdr: boolean
): { allowed: ModelEndpoint[]; blocked: ModelEndpoint[] } {
  if (!zdr) return { allowed: endpoints, blocked: [] }
  return {
    allowed: endpoints.filter((e) => e.zdr),
    blocked: endpoints.filter((e) => !e.zdr),
  }
}

/** Ordered category metadata shared by the lorebook and inspector UIs. */
export const LOREBOOK_CATEGORIES: ReadonlyArray<{
  value: LorebookCategory
  label: string
  pluralLabel: string
}> = [
  { value: "character", label: "Character", pluralLabel: "Characters" },
  // Next to "character" rather than at the end: a class describes who someone
  // is, so the filter row reads people-first before it moves to the world.
  { value: "class", label: "Class", pluralLabel: "Classes" },
  { value: "location", label: "Location", pluralLabel: "Locations" },
  { value: "faction", label: "Faction", pluralLabel: "Factions" },
  { value: "item", label: "Item", pluralLabel: "Items" },
  { value: "event", label: "Event", pluralLabel: "Events" },
  { value: "concept", label: "Concept", pluralLabel: "Concepts" },
]
