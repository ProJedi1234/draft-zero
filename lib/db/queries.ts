// lib/db/queries.ts — Read layer. Server-only: imported by server components
// and server actions. Every call reads fresh from SQLite (no caching layer).

import { asc, desc, eq } from "drizzle-orm"

import { DEFAULT_GENERATION_SETTINGS } from "@/lib/mock-data"
import type {
  AppSettings,
  LorebookEntry,
  Story,
  StorySummary,
} from "@/lib/types"

import { getDb } from "./client"
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
    db
      .select({ storyId: storyEntries.storyId, text: storyEntries.text })
      .from(storyEntries),
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

  const [entryRows, lorebookRows] = await Promise.all([
    db
      .select()
      .from(storyEntries)
      .where(eq(storyEntries.storyId, id))
      .orderBy(asc(storyEntries.position)),
    db.select().from(lorebookEntries),
  ])

  return toStory(storyRow, entryRows, lorebookRows)
}

/** All lorebook entries, ordered name ASC. */
export async function listLorebookEntries(): Promise<LorebookEntry[]> {
  const db = await getDb()
  const rows = await db
    .select()
    .from(lorebookEntries)
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
    openRouterKey: "",
  }
  await db.insert(appSettings).values(defaults).onConflictDoNothing()
  return toAppSettings(defaults)
}
