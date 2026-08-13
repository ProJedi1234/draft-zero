// lib/types.ts — Single source of truth for the draft-zero domain contract.
// Implementation packages import from "@/lib/types" and MUST NOT redefine these.

/** Who produced a passage of story text. */
export type EntrySource = "user" | "generated"

/**
 * The two moves a writer can make. Both are typed in first person and stored
 * translated into second person; see lib/story/action-voice.ts.
 */
export type ActionKind = "say" | "do"

/** One contiguous block of prose in a story (a "passage"). */
export interface StoryEntry {
  id: string
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
  /** ISO-8601 timestamp. */
  createdAt: string
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

/** Generation parameters attached to a story (OpenRouter-shaped). */
export interface GenerationSettings {
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
  /** Range 0–2. */
  temperature: number
  /** Range 0–1. */
  topP: number
  /** Max tokens generated per continuation. */
  maxTokens: number
  /**
   * Token budget for the assembled INPUT context — the ceiling composeContext
   * (lib/generation/context.ts) trims memory, lore and story prose down to.
   * Deliberately distinct from maxTokens, which caps OUTPUT: a writer wants a
   * long memory of the story without paying for long continuations, and vice
   * versa. Always one of CONTEXT_WINDOWS.
   */
  contextWindow: number
  /** Range -2–2. */
  frequencyPenalty: number
  /** Range -2–2. */
  presencePenalty: number
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
  entries: StoryEntry[]
  settings: GenerationSettings
  /** NovelAI-style memory: always included at the top of context. */
  memory: string
  /** Author's note: injected near the most recent words. */
  authorsNote: string
  /** Per-story narrator prompt override; null uses DEFAULT_SYSTEM_PROMPT. */
  systemPrompt: string | null
  /** LorebookEntry ids currently "triggered" for this story (mocked). */
  activeLorebookEntryIds: string[]
}

/** Story metadata without entries — sidebar/library surface. */
export interface StorySummary {
  id: string
  title: string
  description: string
  genre: string
  createdAt: string
  updatedAt: string
  wordCount: number
}

export type LorebookCategory =
  "character" | "location" | "faction" | "item" | "event" | "concept"

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
  defaultModelId: string
  /** Thinking level new stories start from. "off" unless the writer says otherwise. */
  defaultThinking: ThinkingLevel
}

/** Uniform server-action result. Actions never throw for expected failures. */
export type ActionResult<T = null> =
  { ok: true; data: T } | { ok: false; error: string }

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
  /** Display strings, USD per 1M tokens, e.g. { prompt: "$3.00", completion: "$15.00" }. */
  pricing: {
    prompt: string
    completion: string
  }
  /** Reasoning support, or null when the model cannot think. */
  reasoning: ModelReasoning | null
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

/** Ordered category metadata shared by the lorebook and inspector UIs. */
export const LOREBOOK_CATEGORIES: ReadonlyArray<{
  value: LorebookCategory
  label: string
  pluralLabel: string
}> = [
  { value: "character", label: "Character", pluralLabel: "Characters" },
  { value: "location", label: "Location", pluralLabel: "Locations" },
  { value: "faction", label: "Faction", pluralLabel: "Factions" },
  { value: "item", label: "Item", pluralLabel: "Items" },
  { value: "event", label: "Event", pluralLabel: "Events" },
  { value: "concept", label: "Concept", pluralLabel: "Concepts" },
]
