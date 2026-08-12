// lib/db/mappers.ts — Row ↔ domain mapping.
// lib/types.ts is the app-facing contract: components never see Drizzle rows.
// snake_case ↔ camelCase, 0/1 ↔ boolean, keys_json ↔ string[], timestamps pass
// through as ISO strings. wordCount and activeLorebookEntryIds are computed at
// read time and are never stored.

import {
  matchActiveLorebookEntries,
  recentStoryText,
} from "@/lib/generation/lorebook"
import type {
  AppSettings,
  GenerationSettings,
  LorebookCategory,
  LorebookEntry,
  Story,
  StoryEntry,
  StorySummary,
} from "@/lib/types"

import type {
  AppSettingsRow,
  LorebookEntryRow,
  StoryEntryRow,
  StoryRow,
} from "./schema"

/** Whitespace-split word count; blank text counts as 0. */
export function countWords(text: string): number {
  const trimmed = text.trim()
  return trimmed === "" ? 0 : trimmed.split(/\s+/).length
}

export function countEntryWords(entries: { text: string }[]): number {
  return entries.reduce((total, entry) => total + countWords(entry.text), 0)
}

export function parseKeys(keysJson: string): string[] {
  try {
    const parsed: unknown = JSON.parse(keysJson)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((k): k is string => typeof k === "string")
  } catch {
    return []
  }
}

export function serializeKeys(keys: string[]): string {
  return JSON.stringify(keys)
}

export function toStoryEntry(row: StoryEntryRow): StoryEntry {
  return {
    id: row.id,
    source: row.source,
    text: row.text,
    createdAt: row.createdAt,
  }
}

export function toGenerationSettings(row: StoryRow): GenerationSettings {
  return {
    modelId: row.modelId,
    thinking: row.thinking,
    temperature: row.temperature,
    topP: row.topP,
    maxTokens: row.maxTokens,
    frequencyPenalty: row.frequencyPenalty,
    presencePenalty: row.presencePenalty,
  }
}

export function toLorebookEntry(row: LorebookEntryRow): LorebookEntry {
  return {
    id: row.id,
    storyId: row.storyId,
    name: row.name,
    category: row.category as LorebookCategory,
    keys: parseKeys(row.keysJson),
    content: row.content,
    enabled: row.enabled,
    alwaysActive: row.alwaysActive,
    priority: row.priority,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/** Sidebar/library shape — no entries, wordCount computed from the given rows. */
export function toStorySummary(
  row: StoryRow,
  entries: { text: string }[]
): StorySummary {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    genre: row.genre,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    wordCount: countEntryWords(entries),
  }
}

/**
 * Full domain story. `entryRows` must already be ordered by position ASC.
 * `lorebookRows` is this story's lorebook — active ids are recomputed by real
 * trigger matching against the recent story text.
 */
export function toStory(
  row: StoryRow,
  entryRows: StoryEntryRow[],
  lorebookRows: LorebookEntryRow[]
): Story {
  const entries = entryRows.map(toStoryEntry)
  const lorebookEntries = lorebookRows.map(toLorebookEntry)
  const matches = matchActiveLorebookEntries(
    lorebookEntries,
    recentStoryText(entries)
  )

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    genre: row.genre,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    wordCount: countEntryWords(entries),
    entries,
    settings: toGenerationSettings(row),
    memory: row.memory,
    authorsNote: row.authorsNote,
    systemPrompt: row.systemPrompt,
    activeLorebookEntryIds: matches.map((match) => match.entry.id),
  }
}

export function toAppSettings(row: AppSettingsRow): AppSettings {
  return {
    defaultModelId: row.defaultModelId,
    defaultThinking: row.defaultThinking,
  }
}
