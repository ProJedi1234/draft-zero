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
  EntryGeneration,
  GenerationSettings,
  HistoryState,
  LorebookCategory,
  LorebookEntry,
  SettledCallStatus,
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

/**
 * Provenance for one row, or null when the row does not carry it.
 *
 * All three settings columns are written together by the generation path, so
 * requiring all three is not defensive noise: it is the difference between "we
 * recorded this" and "we half-recorded this". A row missing any of them is a
 * user passage or a pre-migration row, and inventing a temperature of 0 to fill
 * the gap would be indistinguishable from a real recorded setting.
 */
function toEntryGeneration(row: StoryEntryRow): EntryGeneration | null {
  if (
    row.genModelId === null ||
    row.genThinking === null ||
    row.genTemperature === null
  ) {
    return null
  }
  return {
    modelId: row.genModelId,
    thinking: row.genThinking,
    temperature: row.genTemperature,
    promptTokens: row.promptTokens,
    completionTokens: row.completionTokens,
  }
}

/**
 * What the spend ledger knows about one take. Absent for user passages, for
 * passages written before the ledger existed, and for anything the recorder
 * failed to open a row for — all three are "we do not know", never zero.
 */
export interface EntryCost {
  /** Decimal string from Postgres `numeric`, or null when the call went unpriced. */
  costUsd: string | null
  reasoningTokens: number | null
  status: SettledCallStatus | null
}

/**
 * `slot` is what the row's own columns cannot tell it: where this take sits
 * among its siblings and how many there are. Both are facts about the whole
 * slot, so they are resolved once in `toStory` and handed down rather than
 * re-derived per row.
 *
 * `cost` is the same shape of fact from a different table — the money lives in
 * generation_calls, not on the entry, so that a stopped or errored call is
 * still counted somewhere. Omitted means "no ledger row", which every user
 * passage is.
 */
export function toStoryEntry(
  row: StoryEntryRow,
  slot: { index: number; count: number },
  cost?: EntryCost | null
): StoryEntry {
  return {
    id: row.id,
    source: row.source,
    text: row.text,
    actionKind: row.actionKind,
    inputText: row.inputText,
    variantGroupId: row.variantGroupId,
    variantIndex: slot.index,
    variantCount: slot.count,
    generation: toEntryGeneration(row),
    costUsd: cost?.costUsd ?? null,
    reasoningTokens: cost?.reasoningTokens ?? null,
    callStatus: cost?.status ?? null,
    createdAt: row.createdAt,
  }
}

export function toGenerationSettings(row: StoryRow): GenerationSettings {
  return {
    modelId: row.modelId,
    thinking: row.thinking,
    providerTag: row.providerTag,
    temperature: row.temperature,
    topP: row.topP,
    maxTokens: row.maxTokens,
    contextWindow: row.contextWindow,
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
 * Full domain story.
 *
 * `entryRows` is EVERY non-deleted row of the story — the active takes and the
 * inactive alternatives alike — already ordered by position ASC, variant_index
 * ASC. The alternatives are here only so each active take can be told how many
 * siblings it has; they never reach the canvas. Everything derived below
 * (wordCount, lorebook triggers) is computed from the ACTIVE list alone, which
 * is what the manuscript actually says.
 *
 * `lorebookRows` is this story's lorebook — active ids are recomputed by real
 * trigger matching against the recent story text.
 *
 * `costs` is the ledger, keyed by entry id. Missing keys are the normal case
 * (every user passage, everything written before the ledger existed) and are
 * left as nulls rather than filled with zeros.
 */
export function toStory(
  row: StoryRow,
  entryRows: StoryEntryRow[],
  lorebookRows: LorebookEntryRow[],
  history: HistoryState,
  costs: ReadonlyMap<string, EntryCost> = new Map()
): Story {
  // Slot membership, in variant_index order — the caller's ORDER BY already
  // guarantees that order, so pushing in arrival order preserves it.
  const slots = new Map<string, StoryEntryRow[]>()
  for (const entryRow of entryRows) {
    const slot = slots.get(entryRow.variantGroupId)
    if (slot) slot.push(entryRow)
    else slots.set(entryRow.variantGroupId, [entryRow])
  }

  const entries = entryRows
    .filter((entryRow) => entryRow.isActive)
    .map((entryRow) => {
      const slot = slots.get(entryRow.variantGroupId) ?? [entryRow]
      return toStoryEntry(
        entryRow,
        { index: slot.indexOf(entryRow), count: slot.length },
        costs.get(entryRow.id) ?? null
      )
    })
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
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    undoSummary: history.undoSummary,
    redoSummary: history.redoSummary,
  }
}

export function toAppSettings(row: AppSettingsRow): AppSettings {
  return {
    defaultModelId: row.defaultModelId,
    defaultThinking: row.defaultThinking,
  }
}
