"use server"

import { eq } from "drizzle-orm"

import { commitChange } from "@/lib/actions/commit"
import { getDb } from "@/lib/db/client"
import { getAppSettings } from "@/lib/db/queries"
import {
  lorebookEntries,
  stories,
  storyEntries,
  storyRecaps,
} from "@/lib/db/schema"
import { MAX_CARDS_BYTES, parseStoryCards } from "@/lib/import/aidungeon"
import {
  MAX_BACKUP_BYTES,
  parseBackup,
  type ParsedBackupPassage,
} from "@/lib/import/aidungeon-backup"
import {
  fillScenarioPlaceholders,
  MAX_SCENARIO_BYTES,
  parseScenario,
} from "@/lib/import/novelai"
import { DEFAULT_GENERATION_SETTINGS } from "@/lib/mock-data"
import type { ActionResult, NewLorebookEntry } from "@/lib/types"

/**
 * Server actions are unauthenticated POST endpoints and their arguments are
 * deserialized without any runtime validation, so the declared parameter type
 * is a hope, not a check. This is the check.
 *
 * The size test is in BYTES, via TextEncoder. `String.length` counts UTF-16
 * code units, which undercounts every non-ASCII export — a CJK file weighs
 * about three bytes per unit, so a `.length` test labelled in bytes passes
 * files three times over the limit. And a non-string payload (a pre-parsed
 * array, say) has a `.length` that is an element count, which sails under any
 * byte ceiling and then reaches the reader's object path directly.
 */
function readFileText(
  value: unknown,
  maxBytes: number
): { ok: true; text: string } | { ok: false; error: string } {
  if (typeof value !== "string") {
    return { ok: false, error: "That import didn't arrive as a file." }
  }
  if (new TextEncoder().encode(value).length > maxBytes) {
    return { ok: false, error: "That file is too large to be an export." }
  }
  return { ok: true, text: value }
}

/**
 * Postgres' wire protocol caps a statement at 65535 bind parameters, and
 * loreRows emits 11 columns per row, so a single INSERT tops out just under
 * 6000 entries — reachable with a large export, and reachable well inside the
 * body-size limit because a minimal card is a few dozen bytes. Past that the
 * driver rejects the whole statement and the transaction rolls back, which
 * surfaces as a thrown action rather than a clean result.
 *
 * 1000 is a round number far below the cap, leaving headroom if the row ever
 * grows a column.
 */
const INSERT_CHUNK_ROWS = 1000

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size))
  return out
}

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
  const file = readFileText(input.json, MAX_SCENARIO_BYTES)
  if (!file.ok) return { ok: false, error: file.error }

  const parsed = parseScenario(file.text)
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
      // Same app default createStory applies. Without it an imported story
      // silently diverges from every story made the normal way.
      thinking: appSettings.defaultThinking,
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

    for (const rows of chunk(loreRows(lore, storyId, now), INSERT_CHUNK_ROWS)) {
      await tx.insert(lorebookEntries).values(rows)
    }
  })

  // Library-level, same as createStory: an import is a new story with no
  // viewers yet, announced to the library rather than to a story. No
  // `entities` hint — it creates a story, so the full catch-up is correct.
  commitChange(null)
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
  const file = readFileText(input.json, MAX_CARDS_BYTES)
  if (!file.ok) return { ok: false, error: file.error }

  const parsed = parseStoryCards(file.text)
  if (!parsed.ok) return { ok: false, error: parsed.error }
  const cards = parsed.data

  const db = await getDb()
  const appSettings = await getAppSettings()
  const now = new Date().toISOString()
  const storyId = crypto.randomUUID()
  // `settingEntries` is deliberately not written here. This path seeds memory
  // from the same text, and keeping both copies would inject the setting bible
  // into every prompt twice — once under [Memory], again as always-active lore.
  const lore = cards.lorebookEntries

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
      // Same app default createStory applies; see importScenario.
      thinking: appSettings.defaultThinking,
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

    for (const rows of chunk(loreRows(lore, storyId, now), INSERT_CHUNK_ROWS)) {
      await tx.insert(lorebookEntries).values(rows)
    }
  })

  // Null, not the new id: a story that did not exist a moment ago is a
  // library-level write, and no device can be sitting on it.
  commitChange(null)
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

// ---------------------------------------------------------------------------
// AI Dungeon backups
// ---------------------------------------------------------------------------

export interface BackupImportSummary {
  storyId: string
  title: string
  /** How many passages the manuscript arrived with. */
  passageCount: number
  /** How many cards became lorebook entries. */
  lorebookEntryCount: number
  warnings: string[]
}

/**
 * One insertable manuscript row per parsed passage.
 *
 * Every row is its own variant group, named after itself: an imported passage
 * is a slot with one take in it, exactly like the opening passage the other two
 * importers write, and a later retry inserts beside it rather than over it.
 *
 * `createdAt` is the import's timestamp for every row rather than the action's
 * own `createdAt` from the backup. The column is provenance for *this* story,
 * the manuscript is ordered by `position` and never by time, and a backup's
 * timestamps are frequently all identical anyway (the sample's two actions
 * share one to the millisecond) — so carrying them in would put a false history
 * on rows whose real one is "imported, just now".
 */
function passageRows(
  passages: ParsedBackupPassage[],
  storyId: string,
  now: string
): (typeof storyEntries.$inferInsert)[] {
  return passages.map((passage, position) => {
    const id = crypto.randomUUID()
    return {
      id,
      storyId,
      position,
      variantGroupId: id,
      variantIndex: 0,
      isActive: true,
      source: passage.source,
      text: passage.text,
      // Null together or set together — see the schema. The reader guarantees
      // the pair, so nothing here has to reconcile them.
      actionKind: passage.actionKind,
      inputText: passage.inputText,
      createdAt: now,
    }
  })
}

/**
 * Imports an AI Dungeon backup archive as a new story: the manuscript, the
 * lorebook, the memory, the author's note and AI Dungeon's own rolling summary,
 * all in one write.
 *
 * The archive crosses the wire as a `File` and not as text, unlike the two JSON
 * importers. A backup is mostly action JSON, which deflates by roughly an order
 * of magnitude, so sending the zip is what keeps a long adventure inside a
 * Server Action body at all — and the server re-reads those bytes rather than
 * trusting the preview the client parsed from them.
 */
export async function importAiDungeonBackup(input: {
  /** The raw `.zip` backup. */
  file: File
}): Promise<ActionResult<BackupImportSummary>> {
  // Same reasoning as readFileText: the argument type is a hope, not a check.
  // `size` is read before any bytes are, so an oversized archive is refused
  // without ever being held in memory.
  if (!(input.file instanceof File)) {
    return { ok: false, error: "That import didn't arrive as a file." }
  }
  if (input.file.size > MAX_BACKUP_BYTES) {
    return { ok: false, error: "That backup is too large to import." }
  }

  const parsed = await parseBackup(await input.file.arrayBuffer())
  if (!parsed.ok) return { ok: false, error: parsed.error }
  const backup = parsed.data

  const db = await getDb()
  const appSettings = await getAppSettings()
  const now = new Date().toISOString()
  const storyId = crypto.randomUUID()

  // `settingEntries` is dropped for the same reason importStoryCards drops it:
  // this path seeds memory from the same text, and keeping both copies would
  // inject the setting bible into every prompt twice.
  const lore = backup.lorebookEntries
  const rows = passageRows(backup.passages, storyId, now)

  const memory = [backup.memory, backup.worldDescription]
    .filter((text) => text !== "")
    .join("\n\n")

  await db.transaction(async (tx) => {
    await tx.insert(stories).values({
      id: storyId,
      title: backup.title,
      description: backup.description,
      // Same mapping importStoryCards makes: AI Dungeon has no genre field, and
      // its tags are the free-form plural taxonomy the story header renders
      // there.
      genre: backup.tags.join(", "),
      memory,
      authorsNote: backup.authorsNote,
      // AI Dungeon's AI instructions ARE a system prompt, so they land as one —
      // replacing the built-in narrator prompt rather than being folded into
      // the story's context blocks. NULL when the adventure carried none, which
      // is what keeps a story that never had instructions following
      // DEFAULT_SYSTEM_PROMPT as that text keeps changing; writing "" instead
      // would resolve to the same prompt today and freeze nothing, but it makes
      // "no override" and "an override that happens to be empty" the same row.
      systemPrompt: backup.instructions === "" ? null : backup.instructions,
      // A backup names no sampler settings — AI Dungeon's are per-model and
      // per-account, not per-adventure — so the app defaults stand.
      ...DEFAULT_GENERATION_SETTINGS,
      modelId: appSettings.defaultModelId,
      thinking: appSettings.defaultThinking,
      createdAt: now,
      updatedAt: now,
    })

    for (const batch of chunk(rows, INSERT_CHUNK_ROWS)) {
      await tx.insert(storyEntries).values(batch)
    }

    // AI Dungeon's own summary, adopted as the story's first recap version
    // rather than folded into memory. It is the same object our summarizer
    // writes — a rolling recap covering everything up to a passage — so it
    // belongs in the same table, where the next summarization supersedes it by
    // writing a wider version and a rewind past its coverage retires it.
    //
    // It needs a passage to hang from: `through_entry_id` is what resolves a
    // recap, so a summary with no manuscript behind it has nothing to cover and
    // is dropped rather than pointed at a row that does not exist.
    const last = rows.at(-1)
    if (backup.summary !== "" && last) {
      await tx.insert(storyRecaps).values({
        id: crypto.randomUUID(),
        storyId,
        throughEntryId: last.id,
        throughPosition: last.position,
        text: backup.summary,
        // Null, not the app default: AI Dungeon wrote this, and naming one of
        // our models would be a record of something that never happened.
        genModelId: null,
        createdAt: now,
      })
    }

    for (const batch of chunk(
      loreRows(lore, storyId, now),
      INSERT_CHUNK_ROWS
    )) {
      await tx.insert(lorebookEntries).values(batch)
    }
  })

  // Library-level, same as every other import: the story did not exist a moment
  // ago, so no device can be sitting on it.
  commitChange(null)
  return {
    ok: true,
    data: {
      storyId,
      title: backup.title,
      passageCount: rows.length,
      lorebookEntryCount: lore.length,
      warnings: backup.warnings,
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
 * remembers. The setting cards still arrive — as always-active entries — so the
 * setting reaches every generation without overwriting a word the writer wrote.
 *
 * Collision policy: a card whose name already exists IN THIS STORY is SKIPPED,
 * matched case-insensitively on the trimmed name. Overwriting would destroy
 * hand-edited entries with no undo, and importing a second copy would double the
 * entry's text into every context that matches its keys. Skipping is the only
 * outcome a writer can recover from by hand, and the count comes back in the
 * summary so it is never silent.
 *
 * Cards that collide only with EACH OTHER are all kept — that is the reader's
 * documented behaviour and what the new-story path does, and counting them as
 * skips reported collisions against a story that never had them.
 */
export async function importStoryCardsIntoStory(input: {
  storyId: string
  /** Raw export file text. */
  json: string
}): Promise<ActionResult<StoryCardMergeSummary>> {
  const file = readFileText(input.json, MAX_CARDS_BYTES)
  if (!file.ok) return { ok: false, error: file.error }

  const parsed = parseStoryCards(file.text)
  if (!parsed.ok) return { ok: false, error: parsed.error }
  const cards = parsed.data

  const db = await getDb()
  const now = new Date().toISOString()
  const warnings = [...cards.warnings]

  // The setting cards ARE written here, unlike the new-story path: memory is
  // left alone, so an always-active entry is the only way the setting reaches a
  // generation.
  const incoming = [...cards.lorebookEntries, ...cards.settingEntries]

  // Existence check, name read and rows written in ONE transaction. Checking
  // existence on a separate connection first left a window where the story
  // could be deleted in between, and the insert would then hit the story_id
  // foreign key and throw a raw constraint error instead of returning the tidy
  // "Story not found." below.
  //
  // Atomicity, not isolation: at Postgres' default READ COMMITTED, and with
  // only a non-unique index on (story_id, name), two imports of the same file
  // running at once would each miss the other's uncommitted rows and both
  // insert. A single writer is the assumption here, as everywhere else.
  let added = 0
  let skipped = 0
  let missing = false

  await db.transaction(async (tx) => {
    const story = await tx
      .select({ id: stories.id })
      .from(stories)
      .where(eq(stories.id, input.storyId))
      .limit(1)
      .then((rows) => rows[0])
    if (!story) {
      missing = true
      return
    }

    const existing = await tx
      .select({ name: lorebookEntries.name })
      .from(lorebookEntries)
      .where(eq(lorebookEntries.storyId, input.storyId))
    const taken = new Set(existing.map((row) => row.name.trim().toLowerCase()))

    // Only names the STORY already holds are skipped. Cards that collide with
    // each other inside the same file are all kept, exactly as the new-story
    // path keeps them and as the reader's own "imported as separate entries"
    // warning promises. Folding the file against itself as well used to drop
    // every card after the first sharing a name — including the synthesized
    // "Untitled entry" placeholder, which is not a name the story ever had, and
    // which every later import would then collide with forever.
    const fresh = incoming.filter(
      (entry) => !taken.has(entry.name.trim().toLowerCase())
    )

    added = fresh.length
    skipped = incoming.length - added

    for (const rows of chunk(
      loreRows(fresh, input.storyId, now),
      INSERT_CHUNK_ROWS
    )) {
      await tx.insert(lorebookEntries).values(rows)
    }
  })

  if (missing) return { ok: false, error: "Story not found." }

  if (skipped > 0) {
    warnings.push(
      `Skipped ${skipped} ${
        skipped === 1 ? "card" : "cards"
      } already in this lorebook by name.`
    )
  }

  // Same one-line commit every mutating action uses. Uncovered on purpose: a
  // bulk import is the one lore write whose rows do not ride the bus, so every
  // device — this one included — answers it with a partition read rather than
  // N entity events. See lib/store/lore-revalidate.ts.
  commitChange(input.storyId, ["lorebook-entry"])
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
