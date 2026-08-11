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

/** Generation parameters attached to a story (OpenRouter-shaped). */
export interface GenerationSettings {
  /** OpenRouter model id, e.g. "anthropic/claude-sonnet-4.5". */
  modelId: string
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
  /** LorebookEntry ids currently "triggered" for this story (mocked). */
  activeLorebookEntryIds: string[]
}

export type LorebookCategory =
  | "character"
  | "location"
  | "faction"
  | "item"
  | "event"
  | "concept"

export interface LorebookEntry {
  id: string
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
