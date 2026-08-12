// lib/types.ts — Single source of truth for the draft-zero domain contract.
// Implementation packages import from "@/lib/types" and MUST NOT redefine these.

/** Who produced a passage of story text. */
export type EntrySource = "user" | "generated"

/** One contiguous block of prose in a story (a "passage"). */
export interface StoryEntry {
  id: string
  source: EntrySource
  /** Prose text. Paragraphs are separated by "\n\n". */
  text: string
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

/** Generation parameters attached to a story (OpenRouter-shaped). */
export interface GenerationSettings {
  /** OpenRouter model id, e.g. "anthropic/claude-sonnet-4.5". */
  modelId: string
  /**
   * How hard the model should think before writing. Always "off" for a new
   * story — thinking is opt-in, and non-thinking models ignore it entirely.
   */
  thinking: ThinkingLevel
  /** Range 0–2. */
  temperature: number
  /** Range 0–1. */
  topP: number
  /** Max tokens generated per continuation. */
  maxTokens: number
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
  /** e.g. "anthropic/claude-sonnet-4.5" */
  id: string
  /** Display name, e.g. "Claude Sonnet 4.5". */
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
