// lib/db/queries.ts — Read layer. Server-only: imported by server components
// and server actions. Every call reads fresh from Postgres (no caching layer).

import { and, asc, desc, eq, isNull } from "drizzle-orm"

import { DEFAULT_GENERATION_SETTINGS } from "@/lib/mock-data"
import type {
  AppSettings,
  LorebookEntry,
  Story,
  StorySummary,
} from "@/lib/types"

import { getDb } from "./client"
import { readHistoryState } from "./journal"
import {
  toAppSettings,
  toLorebookEntry,
  toStory,
  toStorySummary,
} from "./mappers"
import { appSettings, lorebookEntries, storyEntries, stories } from "./schema"

/** All stories, ordered updated_at DESC. wordCount computed per story. */
export async function listStories(): Promise<StorySummary[]> {
  const db = await getDb()
  const [storyRows, entryRows] = await Promise.all([
    db.select().from(stories).orderBy(desc(stories.updatedAt)),
    // Only the rows that are actually in the manuscript count towards the
    // library's word count. Soft-deleted passages and the inactive takes of a
    // retried slot are still on disk and would otherwise inflate the number
    // with prose the writer cannot see.
    db
      .select({ storyId: storyEntries.storyId, text: storyEntries.text })
      .from(storyEntries)
      .where(
        and(isNull(storyEntries.deletedAt), eq(storyEntries.isActive, true))
      ),
  ])

  const textsByStory = new Map<string, { text: string }[]>()
  for (const entry of entryRows) {
    const bucket = textsByStory.get(entry.storyId)
    if (bucket) bucket.push({ text: entry.text })
    else textsByStory.set(entry.storyId, [{ text: entry.text }])
  }

  return storyRows.map((row) =>
    toStorySummary(row, textsByStory.get(row.id) ?? [])
  )
}

/** Full story with entries, settings, computed wordCount + activeLorebookEntryIds. */
export async function getStory(id: string): Promise<Story | null> {
  const db = await getDb()
  const storyRow = await db
    .select()
    .from(stories)
    .where(eq(stories.id, id))
    .limit(1)
    .then((rows) => rows[0])

  if (!storyRow) return null

  const [entryRows, lorebookRows, history] = await Promise.all([
    // Every non-deleted row, active takes and alternatives alike. One flat
    // query rather than a GROUP BY plus a join for the sibling counts: a
    // manuscript is small and is already loaded whole on every request, so the
    // extra inactive rows cost less than the second round trip would, and
    // `toStory` gets everything it needs to fill in variantIndex/variantCount.
    db
      .select()
      .from(storyEntries)
      .where(and(eq(storyEntries.storyId, id), isNull(storyEntries.deletedAt)))
      .orderBy(asc(storyEntries.position), asc(storyEntries.variantIndex)),
    db.select().from(lorebookEntries).where(eq(lorebookEntries.storyId, id)),
    readHistoryState(db, id),
  ])

  return toStory(storyRow, entryRows, lorebookRows, history)
}

/** One story's lorebook entries, ordered name ASC. */
export async function listLorebookEntries(
  storyId: string
): Promise<LorebookEntry[]> {
  const db = await getDb()
  const rows = await db
    .select()
    .from(lorebookEntries)
    .where(eq(lorebookEntries.storyId, storyId))
    .orderBy(asc(lorebookEntries.name))
  return rows.map(toLorebookEntry)
}

export async function getLorebookEntry(
  id: string
): Promise<LorebookEntry | null> {
  const db = await getDb()
  const row = await db
    .select()
    .from(lorebookEntries)
    .where(eq(lorebookEntries.id, id))
    .limit(1)
    .then((rows) => rows[0])
  return row ? toLorebookEntry(row) : null
}

/** Reads (and lazily creates with defaults) the single settings row. */
export async function getAppSettings(): Promise<AppSettings> {
  const db = await getDb()
  const existing = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.id, 1))
    .limit(1)
    .then((rows) => rows[0])

  if (existing) return toAppSettings(existing)

  const defaults = {
    id: 1,
    defaultModelId: DEFAULT_GENERATION_SETTINGS.modelId,
    defaultThinking: DEFAULT_GENERATION_SETTINGS.thinking,
  }
  await db.insert(appSettings).values(defaults).onConflictDoNothing()
  return toAppSettings(defaults)
}
