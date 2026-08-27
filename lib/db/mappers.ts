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
  StoryImage,
  StoryRecap,
  StorySummary,
} from "@/lib/types"

import type {
  AppSettingsRow,
  LorebookEntryRow,
  ModelProfileRow,
  StoryEntryRow,
  StoryImageRow,
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
/**
 * A picture's money, from the ledger.
 *
 * `slotCostUsd` is the whole slot — every draw of this illustration, including
 * the takes the writer moved on from. Retrying a picture spends again, and a
 * chip that only ever showed the visible take would under-report a slot three
 * draws deep by exactly the amount that surprises people.
 */
export interface ImageCost {
  costUsd: string | null
  status: SettledCallStatus
  slotCostUsd: string | null
  /** Settled draws of this slot with no price — the "+" in "$0.12+". */
  slotUnpricedCalls: number
}

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
    position: row.position,
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

/**
 * `slot` is this illustration's position among its takes, resolved once in
 * `toStory` for the same reason a passage's is — it is a fact about the group,
 * not about the row.
 *
 * `cost` is absent for any picture with no ledger row — every illustration the
 * offline mock produced, which bills nothing and records nothing.
 */
export function toStoryImage(
  row: StoryImageRow,
  slot: { index: number; count: number },
  cost: ImageCost | null = null
): StoryImage {
  return {
    id: row.id,
    position: row.position,
    imageGroupId: row.imageGroupId,
    imageIndex: slot.index,
    imageCount: slot.count,
    prompt: row.prompt,
    derivedPrompt: row.derivedPrompt,
    modelId: row.modelId,
    aspectRatio: row.aspectRatio,
    seed: row.seed,
    mediaType: row.mediaType,
    costUsd: cost?.costUsd ?? null,
    callStatus: cost?.status ?? null,
    slotCostUsd: cost?.slotCostUsd ?? null,
    slotUnpricedCalls: cost?.slotUnpricedCalls ?? 0,
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
  wordCount?: number
): StorySummary {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    genre: row.genre,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    wordCount,
    tintHue: row.tintHue,
    tintStrength: row.tintStrength,
  }
}

/**
 * Where the active take of a slot sits among its siblings — the per-slot facts
 * toStoryEntry needs, without the sibling rows themselves. Derived in JS by
 * deriveSlotMeta when the whole manuscript is in hand, or aggregated in SQL by
 * the windowed read, which never loads the inactive takes' text at all.
 */
export type SlotMeta = {
  /** 0-based position of the ACTIVE take, in variantIndex order. */
  index: number
  count: number
  profilesMixed: boolean
}

/** A slot that has never been retried — every group absent from the meta map. */
const SOLO_SLOT: SlotMeta = { index: 0, count: 1, profilesMixed: false }

/**
 * Slot metadata from a full row set — every non-deleted row of the story,
 * ordered position ASC, variant_index ASC (the caller's ORDER BY is what
 * guarantees the in-slot order the index is measured against).
 */
export function deriveSlotMeta(
  entryRows: StoryEntryRow[]
): Map<string, SlotMeta> {
  const slots = new Map<string, StoryEntryRow[]>()
  for (const entryRow of entryRows) {
    const slot = slots.get(entryRow.variantGroupId)
    if (slot) slot.push(entryRow)
    else slots.set(entryRow.variantGroupId, [entryRow])
  }

  const meta = new Map<string, SlotMeta>()
  for (const [groupId, slot] of slots) {
    if (slot.length < 2) continue
    const active = slot.find((entryRow) => entryRow.isActive)
    if (!active) continue
    meta.set(groupId, {
      index: slot.indexOf(active),
      count: slot.length,
      profilesMixed: slotProfilesMixed(slot),
    })
  }
  return meta
}

/**
 * What the windowed read knows about the manuscript around the tail it loaded.
 * Null means the rows ARE the whole manuscript and everything is derivable
 * from them.
 */
export type ManuscriptWindow = {
  entriesBefore: number
  charsBefore: number
  hasMoreBefore: boolean
  windowStartPosition: number | null
  wordCount: number
  generatedSpan: { firstIso: string; lastIso: string } | null
}

/**
 * Full domain story.
 *
 * `activeEntryRows` is the manuscript as rendered — the active take of every
 * live slot, position ASC — or a tail window of it when `window` is set. The
 * inactive alternatives never reach this function anymore: everything a take
 * needs to know about its siblings arrives through `slots`.
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
  activeEntryRows: StoryEntryRow[],
  slots: ReadonlyMap<string, SlotMeta>,
  imageRows: StoryImageRow[],
  lorebookRows: LorebookEntryRow[],
  history: HistoryState,
  /** The resolved recap text, or "" when this story has none. */
  summary: string,
  /**
   * What the settings resolve against: the global slider defaults a followed
   * profile's null fields fall back to, and the app-wide retention floor.
   */
  baseline: GenerationBaseline,
  costs: ReadonlyMap<string, EntryCost> = new Map(),
  /** Settled ledger cost per illustration id; absent means no row. */
  imageCosts: ReadonlyMap<string, ImageCost> = new Map(),
  window: ManuscriptWindow | null = null
): Story {
  const entries = activeEntryRows.map((entryRow) =>
    toStoryEntry(
      entryRow,
      slots.get(entryRow.variantGroupId) ?? SOLO_SLOT,
      costs.get(entryRow.id) ?? null
    )
  )
  // Same grouping the passages get, for the same reason: the switcher needs to
  // know where in its slot a take sits, and only the whole slot can say.
  const imageSlots = new Map<string, StoryImageRow[]>()
  for (const imageRow of imageRows) {
    const slot = imageSlots.get(imageRow.imageGroupId)
    if (slot) slot.push(imageRow)
    else imageSlots.set(imageRow.imageGroupId, [imageRow])
  }
  const images = imageRows
    .filter((imageRow) => imageRow.isActive)
    .map((imageRow) => {
      const slot = imageSlots.get(imageRow.imageGroupId) ?? [imageRow]
      return toStoryImage(
        imageRow,
        { index: slot.indexOf(imageRow), count: slot.length },
        imageCosts.get(imageRow.id) ?? null
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
    // The aggregate when windowed — the tail alone would undercount.
    wordCount: window ? window.wordCount : countEntryWords(entries),
    entries,
    entriesBefore: window?.entriesBefore,
    charsBefore: window?.charsBefore,
    hasMoreBefore: window?.hasMoreBefore,
    windowStartPosition: window?.windowStartPosition ?? undefined,
    generatedSpan: window ? window.generatedSpan : undefined,
    images,
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
    tintHue: row.tintHue,
    tintStrength: row.tintStrength,
    tintAuto: row.tintAuto,
    imageModelId: row.imageModelId,
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
      temperature: row.summaryTemperature,
      targetWords: row.summaryTargetWords,
      maxTokens: row.summaryMaxTokens,
    },
    atmosphere: {
      modelId: row.atmosphereModelId,
      thinking: row.atmosphereThinking,
      providerTag: row.atmosphereProviderTag,
      zdr: row.atmosphereZdr,
      temperature: row.atmosphereTemperature,
    },
    requireZdr: row.requireZdr,
    defaultImageModelId: row.defaultImageModelId,
    imageContextTokens: row.imageContextTokens,
  }
}

/** The six shared slider values, unprefixed for everything downstream. */
export function toGenerationDefaults(row: AppSettingsRow): GenerationDefaults {
  return {
    temperature: row.defaultTemperature,
    topP: row.defaultTopP,
    contextWindow: row.defaultContextWindow,
    loreBudget: row.defaultLoreBudget,
    frequencyPenalty: row.defaultFrequencyPenalty,
    presencePenalty: row.defaultPresencePenalty,
  }
}
