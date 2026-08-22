// lib/db/mappers.ts — Row ↔ domain mapping.
// lib/types.ts is the app-facing contract: components never see Drizzle rows.
// snake_case ↔ camelCase, 0/1 ↔ boolean, keys_json ↔ string[], timestamps pass
// through as ISO strings. wordCount and activeLorebookEntryIds are computed at
// read time and are never stored.

import {
  buildScanSources,
  matchActiveLorebookEntries,
} from "@/lib/generation/lorebook"
import { resolveGenerationSettings } from "@/lib/generation/resolve"
import type {
  AppSettings,
  EntryGeneration,
  GenerationBaseline,
  GenerationDefaults,
  GenerationSettings,
  HistoryState,
  LorebookCategory,
  LorebookEntry,
  ModelProfile,
  ProfileSettings,
  SettledCallStatus,
  Story,
  StoryEntry,
  StoryRecap,
  StorySummary,
} from "@/lib/types"

import type {
  AppSettingsRow,
  LorebookEntryRow,
  ModelProfileRow,
  StoryEntryRow,
  StoryRecapRow,
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
 *
 * The profile name is NOT part of that group: a take generated under a Custom
 * story has every setting recorded and no profile to name, so requiring it
 * would throw away the record of half the manuscript.
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
    profileName: row.genProfileName,
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
 * Did this slot's takes come from more than one profile?
 *
 * A missing name counts as its own answer rather than as "unknown": a take
 * generated under a Custom story's own columns really did come from somewhere
 * else than one generated under a profile, and the writer comparing the two
 * wants to be told which is which. The cost of that choice is a pre-migration
 * take sitting beside a named one, which reads as mixed and is — we just
 * cannot name its half.
 */
export function slotProfilesMixed(
  rows: Pick<StoryEntryRow, "genProfileName">[]
): boolean {
  return new Set(rows.map((row) => row.genProfileName)).size > 1
}

/**
 * `slot` is what the row's own columns cannot tell it: where this take sits
 * among its siblings, how many there are, and whether they agree about what
 * wrote them. All three are facts about the whole slot, so they are resolved
 * once in `toStory` and handed down rather than re-derived per row.
 *
 * `cost` is the same shape of fact from a different table — the money lives in
 * generation_calls, not on the entry, so that a stopped or errored call is
 * still counted somewhere. Omitted means "no ledger row", which every user
 * passage is.
 */
export function toStoryEntry(
  row: StoryEntryRow,
  slot: { index: number; count: number; profilesMixed: boolean },
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
    variantProfilesMixed: slot.profilesMixed,
    generation: toEntryGeneration(row),
    costUsd: cost?.costUsd ?? null,
    reasoningTokens: cost?.reasoningTokens ?? null,
    callStatus: cost?.status ?? null,
    createdAt: row.createdAt,
  }
}

/** A story's own columns, which are always concrete — Custom or not. */
export function toGenerationSettings(row: StoryRow): GenerationSettings {
  return {
    modelId: row.modelId,
    thinking: row.thinking,
    providerTag: row.providerTag,
    zdr: row.zdr,
    temperature: row.temperature,
    topP: row.topP,
    maxTokens: row.maxTokens,
    contextWindow: row.contextWindow,
    loreBudget: row.loreBudget,
    frequencyPenalty: row.frequencyPenalty,
    presencePenalty: row.presencePenalty,
  }
}

/**
 * A profile's columns, nulls and all. Same field names as the story mapper
 * above, one type looser: a null slider here is an inherited field, not a
 * missing one, and only lib/generation/resolve.ts turns it into a number.
 */
export function toProfileSettings(row: ModelProfileRow): ProfileSettings {
  return {
    modelId: row.modelId,
    thinking: row.thinking,
    providerTag: row.providerTag,
    zdr: row.zdr,
    temperature: row.temperature,
    topP: row.topP,
    maxTokens: row.maxTokens,
    contextWindow: row.contextWindow,
    loreBudget: row.loreBudget,
    frequencyPenalty: row.frequencyPenalty,
    presencePenalty: row.presencePenalty,
  }
}

export function toModelProfile(row: ModelProfileRow): ModelProfile {
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sortOrder,
    settings: toProfileSettings(row),
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
export function toStoryRecap(row: StoryRecapRow): StoryRecap {
  return {
    id: row.id,
    text: row.text,
    throughEntryId: row.throughEntryId,
    throughPosition: row.throughPosition,
    createdAt: row.createdAt,
  }
}

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
 *
 * `profileRow` is the profile named by `row.profileId`, and is what makes the
 * settings EFFECTIVE rather than raw: a followed story reads through it, so
 * editing a profile moves every follower with no fan-out write. The story's own
 * columns still hold its custom settings underneath, untouched. A profileId
 * with no row is a story whose profile went away without its followers being
 * flipped; that is Custom, and the columns it kept are exactly right for it.
 */
export function toStory(
  row: StoryRow,
  profileRow: ModelProfileRow | null,
  entryRows: StoryEntryRow[],
  lorebookRows: LorebookEntryRow[],
  history: HistoryState,
  /** The resolved recap text, or "" when this story has none. */
  summary: string,
  /**
   * What the settings resolve against: the global slider defaults a followed
   * profile's null fields fall back to, and the app-wide retention floor.
   */
  baseline: GenerationBaseline,
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
        {
          index: slot.indexOf(entryRow),
          count: slot.length,
          profilesMixed: slotProfilesMixed(slot),
        },
        costs.get(entryRow.id) ?? null
      )
    })
  const lorebookEntries = lorebookRows.map(toLorebookEntry)
  const matches = matchActiveLorebookEntries(
    lorebookEntries,
    buildScanSources({
      entries,
      memory: row.memory,
      authorsNote: row.authorsNote,
    })
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
    profileId: profileRow ? row.profileId : null,
    settings: resolveGenerationSettings(
      toGenerationSettings(row),
      profileRow ? toModelProfile(profileRow) : null,
      baseline
    ),
    memory: row.memory,
    authorsNote: row.authorsNote,
    summarize: row.summarize,
    summary,
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
    defaultProfileId: row.defaultProfileId,
    defaultGeneration: toGenerationDefaults(row),
    summarizer: {
      modelId: row.summaryModelId,
      thinking: row.summaryThinking,
      providerTag: row.summaryProviderTag,
      zdr: row.summaryZdr,
    },
    requireZdr: row.requireZdr,
  }
}

/** The six shared slider values, unprefixed for everything downstream. */
export function toGenerationDefaults(row: AppSettingsRow): GenerationDefaults {
  return {
    temperature: row.defaultTemperature,
    topP: row.defaultTopP,
    maxTokens: row.defaultMaxTokens,
    contextWindow: row.defaultContextWindow,
    loreBudget: row.defaultLoreBudget,
    frequencyPenalty: row.defaultFrequencyPenalty,
    presencePenalty: row.defaultPresencePenalty,
  }
}
