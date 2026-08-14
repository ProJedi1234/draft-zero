"use server"

import { eq } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import { getDb } from "@/lib/db/client"
import { getAppSettings } from "@/lib/db/queries"
import { lorebookEntries, stories, storyEntries } from "@/lib/db/schema"
import { MAX_CARDS_BYTES, parseStoryCards } from "@/lib/import/aidungeon"
import {
  fillScenarioPlaceholders,
  MAX_SCENARIO_BYTES,
  parseScenario,
} from "@/lib/import/novelai"
import { DEFAULT_GENERATION_SETTINGS } from "@/lib/mock-data"
import type { ActionResult, NewLorebookEntry } from "@/lib/types"

/**
 * One insertable lorebook row per parsed entry. Ids and timestamps are minted
 * here rather than in the reader — the readers are pure and client-side, and
 * nothing a client sends should decide a primary key.
 */
function loreRows(
  entries: NewLorebookEntry[],
  storyId: string,
  now: string
): (typeof lorebookEntries.$inferInsert)[] {
  return entries.map((entry) => ({
    id: crypto.randomUUID(),
    storyId,
    name: entry.name,
    category: entry.category,
    keysJson: JSON.stringify(entry.keys),
    content: entry.content,
    enabled: entry.enabled,
    alwaysActive: entry.alwaysActive,
    priority: entry.priority,
    createdAt: now,
    updatedAt: now,
  }))
}

export interface ScenarioImportSummary {
  storyId: string
  title: string
  /** How many lorebook entries came with the scenario. */
  lorebookEntryCount: number
  warnings: string[]
}

/**
 * Imports a NovelAI `.scenario` file as a new story, lorebook and all — the
 * scenario's lore belongs to the story it arrived with, which is also how
 * NovelAI stores it.
 *
 * The client parses the same bytes to render its preview, but the payload that
 * gets written is re-derived here — the action trusts the file text and the
 * placeholder values, nothing else.
 */
export async function importScenario(input: {
  /** Raw `.scenario` file text. */
  json: string
  /** Values for the scenario's `${…}` placeholders, keyed by placeholder id. */
  placeholderValues?: Record<string, string>
}): Promise<ActionResult<ScenarioImportSummary>> {
  if (input.json.length > MAX_SCENARIO_BYTES) {
    return { ok: false, error: "That file is too large to be a scenario." }
  }

  const parsed = parseScenario(input.json)
  if (!parsed.ok) return { ok: false, error: parsed.error }

  const scenario = fillScenarioPlaceholders(
    parsed.data,
    input.placeholderValues ?? {}
  )

  const db = await getDb()
  const appSettings = await getAppSettings()
  const now = new Date().toISOString()
  const storyId = crypto.randomUUID()
  const lore = scenario.lorebookEntries

  await db.transaction(async (tx) => {
    await tx.insert(stories).values({
      id: storyId,
      title: scenario.title,
      description: scenario.description,
      genre: scenario.genre,
      memory: scenario.memory,
      authorsNote: scenario.authorsNote,
      ...DEFAULT_GENERATION_SETTINGS,
      // The scenario overrides only the sampler values it can speak for; the
      // model stays the app default, since NovelAI names its own (readSettings).
      ...scenario.settings,
      modelId: appSettings.defaultModelId,
      createdAt: now,
      updatedAt: now,
    })

    if (scenario.prompt !== "") {
      // The id is minted up front because the row is its own variant group: an
      // imported prompt is a one-take slot, and every slot names itself after
      // the take that opened it.
      const promptEntryId = crypto.randomUUID()
      await tx.insert(storyEntries).values({
        id: promptEntryId,
        storyId,
        position: 0,
        variantGroupId: promptEntryId,
        variantIndex: 0,
        isActive: true,
        // The prompt is authored text, not model output — and not a player
        // turn either, so action_kind and input_text stay NULL. That is what
        // keeps the opening passage rendering verbatim instead of being read
        // as something translateAction produced.
        source: "user",
        text: scenario.prompt,
        createdAt: now,
      })
    }

    if (lore.length > 0) {
      await tx.insert(lorebookEntries).values(loreRows(lore, storyId, now))
    }
  })

  revalidatePath("/", "layout")
  return {
    ok: true,
    data: {
      storyId,
      title: scenario.title,
      lorebookEntryCount: lore.length,
      warnings: scenario.warnings,
    },
  }
}

// ---------------------------------------------------------------------------
// AI Dungeon story cards
// ---------------------------------------------------------------------------

export interface StoryCardImportSummary {
  storyId: string
  title: string
  /** How many cards became lorebook entries. */
  lorebookEntryCount: number
  warnings: string[]
}

/**
 * Imports an AI Dungeon story-card export as a new story. A card file is a
 * world without a story in it — usually there is no prompt at all — so what
 * this really creates is an empty story wearing someone's setting.
 *
 * The client parses the same bytes to render its preview, but the payload that
 * gets written is re-derived here — the action trusts the file text, nothing
 * else.
 */
export async function importStoryCards(input: {
  /** Raw export file text. */
  json: string
}): Promise<ActionResult<StoryCardImportSummary>> {
  if (input.json.length > MAX_CARDS_BYTES) {
    return { ok: false, error: "That file is too large to be an export." }
  }

  const parsed = parseStoryCards(input.json)
  if (!parsed.ok) return { ok: false, error: parsed.error }
  const cards = parsed.data

  const db = await getDb()
  const appSettings = await getAppSettings()
  const now = new Date().toISOString()
  const storyId = crypto.randomUUID()
  // The reader emits every worldDescription card twice: once on
  // `worldDescription`, once as an always-active entry for the merge path,
  // which must not touch an existing story's memory. This path does seed
  // memory, so keeping the lore copy would inject the setting bible into every
  // prompt twice — once under [Memory] and again as always-active lore.
  const lore = cards.lorebookEntries.filter((entry) => !entry.alwaysActive)

  // The worldDescription card is the setting bible, so it seeds memory — but a
  // scenario export can carry its own memory too, and that one was written to
  // be memory. Keep both, in that order, rather than letting either win.
  const memory = [cards.memory, cards.worldDescription]
    .filter((text) => text !== "")
    .join("\n\n")

  await db.transaction(async (tx) => {
    await tx.insert(stories).values({
      id: storyId,
      title: cards.title,
      description: cards.description,
      // AI Dungeon has no genre field, but its tags are the same free-form
      // plural taxonomy NovelAI's importer joins into `genre` — and the story
      // header already renders a joined tag list there.
      genre: cards.tags.join(", "),
      memory,
      authorsNote: cards.authorsNote,
      // A card export names no sampler settings at all — unlike a NovelAI
      // scenario, there is nothing to override the app defaults with.
      ...DEFAULT_GENERATION_SETTINGS,
      modelId: appSettings.defaultModelId,
      createdAt: now,
      updatedAt: now,
    })

    if (cards.prompt !== "") {
      // The id is minted up front because the row is its own variant group: an
      // imported prompt is a one-take slot, and every slot names itself after
      // the take that opened it.
      const promptEntryId = crypto.randomUUID()
      await tx.insert(storyEntries).values({
        id: promptEntryId,
        storyId,
        position: 0,
        variantGroupId: promptEntryId,
        variantIndex: 0,
        isActive: true,
        // The prompt is authored text, not model output — and not a player
        // turn either, so action_kind and input_text stay NULL. That is what
        // keeps the opening passage rendering verbatim instead of being read
        // as something translateAction produced.
        source: "user",
        text: cards.prompt,
        createdAt: now,
      })
    }

    if (lore.length > 0) {
      await tx.insert(lorebookEntries).values(loreRows(lore, storyId, now))
    }
  })

  revalidatePath("/", "layout")
  return {
    ok: true,
    data: {
      storyId,
      title: cards.title,
      lorebookEntryCount: lore.length,
      warnings: cards.warnings,
    },
  }
}

export interface StoryCardMergeSummary {
  storyId: string
  /** How many cards were added to the lorebook. */
  lorebookEntryCount: number
  /** How many were left alone because the story already had that name. */
  skippedCount: number
  warnings: string[]
}

/**
 * Merges an AI Dungeon story-card export into an existing story's lorebook.
 *
 * The story's memory is deliberately untouched: a writer merging a card pack
 * into a story in progress is adding lore, not replacing what the story
 * remembers. The worldDescription card still arrives — as an always-active
 * entry, which is how the reader emits it — so the setting reaches every
 * generation without overwriting a word the writer wrote.
 *
 * Collision policy: a card whose name already exists in this lorebook is
 * SKIPPED, matched case-insensitively on the trimmed name. Overwriting would
 * destroy hand-edited entries with no undo, and importing a second copy would
 * double the entry's text into every context that matches its keys. Skipping is
 * the only outcome a writer can recover from by hand, and the count comes back
 * in the summary so it is never silent.
 */
export async function importStoryCardsIntoStory(input: {
  storyId: string
  /** Raw export file text. */
  json: string
}): Promise<ActionResult<StoryCardMergeSummary>> {
  if (input.json.length > MAX_CARDS_BYTES) {
    return { ok: false, error: "That file is too large to be an export." }
  }

  const parsed = parseStoryCards(input.json)
  if (!parsed.ok) return { ok: false, error: parsed.error }
  const cards = parsed.data

  const db = await getDb()
  const now = new Date().toISOString()
  const warnings = [...cards.warnings]

  const story = await db
    .select({ id: stories.id })
    .from(stories)
    .where(eq(stories.id, input.storyId))
    .limit(1)
    .then((rows) => rows[0])
  if (!story) return { ok: false, error: "Story not found." }

  // The existing names are read and the rows written in one transaction, so
  // either every accepted card lands or none does. That is atomicity, not
  // isolation: at Postgres' default READ COMMITTED, and with only a non-unique
  // index on (story_id, name), two imports of the same file running at once
  // would each miss the other's uncommitted rows and both insert. A single
  // writer is the assumption here, as everywhere else in the app.
  let added = 0
  let skipped = 0

  await db.transaction(async (tx) => {
    const existing = await tx
      .select({ name: lorebookEntries.name })
      .from(lorebookEntries)
      .where(eq(lorebookEntries.storyId, input.storyId))
    const taken = new Set(existing.map((row) => row.name.trim().toLowerCase()))

    const fresh = cards.lorebookEntries.filter((entry) => {
      const fold = entry.name.trim().toLowerCase()
      // Also folded against the cards already accepted from this file: the
      // reader keeps same-titled cards as separate entries, and a merge should
      // not introduce a collision the story didn't already have.
      if (taken.has(fold)) return false
      taken.add(fold)
      return true
    })

    added = fresh.length
    skipped = cards.lorebookEntries.length - added

    if (fresh.length > 0) {
      await tx
        .insert(lorebookEntries)
        .values(loreRows(fresh, input.storyId, now))
    }
  })

  if (skipped > 0) {
    warnings.push(
      `Skipped ${skipped} ${
        skipped === 1 ? "card" : "cards"
      } already in this lorebook by name.`
    )
  }

  // Same one-line revalidation every mutating action uses; the lorebook route
  // is under the root layout, so it re-renders with the rest.
  revalidatePath("/", "layout")
  return {
    ok: true,
    data: {
      storyId: input.storyId,
      lorebookEntryCount: added,
      skippedCount: skipped,
      warnings,
    },
  }
}
