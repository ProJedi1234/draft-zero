// lib/db/queries.ts — Read layer. Server-only: imported by server components
// and server actions. Every call reads fresh from Postgres (no caching layer).

import { and, asc, desc, eq, isNotNull, isNull, ne } from "drizzle-orm"

import { DEFAULT_GENERATION_SETTINGS } from "@/lib/mock-data"
import type {
  AppSettings,
  LorebookEntry,
  ModelProfile,
  SettledCallStatus,
  Story,
  StorySummary,
} from "@/lib/types"

import { getDb } from "./client"
import { readHistoryState } from "./journal"
import type { EntryCost } from "./mappers"
import {
  toAppSettings,
  toLorebookEntry,
  toModelProfile,
  toStory,
  toStorySummary,
} from "./mappers"
import {
  appSettings,
  generationCalls,
  lorebookEntries,
  modelProfiles,
  storyEntries,
  stories,
} from "./schema"

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

  const [entryRows, lorebookRows, history, costRows] = await Promise.all([
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
    // The story's spend, as a second small SELECT rather than a join onto the
    // entries above. A join is the same rows, but a ledger that somehow held two
    // calls for one take would silently DUPLICATE a passage in the manuscript —
    // a bookkeeping oddity has no business being able to do that. Indexed on
    // (story_id, created_at); in-flight calls are excluded because they have no
    // cost yet and no take.
    db
      .select({
        storyEntryId: generationCalls.storyEntryId,
        costUsd: generationCalls.costUsd,
        reasoningTokens: generationCalls.reasoningTokens,
        status: generationCalls.status,
      })
      .from(generationCalls)
      .where(
        and(
          eq(generationCalls.storyId, id),
          isNotNull(generationCalls.storyEntryId),
          ne(generationCalls.status, "streaming")
        )
      ),
  ])

  const costs = new Map<string, EntryCost>()
  for (const row of costRows) {
    if (row.storyEntryId === null) continue
    costs.set(row.storyEntryId, {
      costUsd: row.costUsd,
      reasoningTokens: row.reasoningTokens,
      status: row.status as SettledCallStatus,
    })
  }

  return toStory(storyRow, entryRows, lorebookRows, history, costs)
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

/** Every profile, in the writer's order. */
export async function listModelProfiles(): Promise<ModelProfile[]> {
  const db = await getDb()
  const rows = await db
    .select()
    .from(modelProfiles)
    .orderBy(asc(modelProfiles.sortOrder), asc(modelProfiles.name))
  return rows.map(toModelProfile)
}

/**
 * Fixed rather than a UUID so the seed below is idempotent under a race: two
 * concurrent first reads both insert, and the second one conflicts away
 * instead of leaving a duplicate "Default" behind.
 */
const SEEDED_DEFAULT_PROFILE_ID = "default-profile"

/**
 * Reads (and lazily creates with defaults) the single settings row, then does
 * the same for the default profile.
 *
 * The profile seed is the migration: default_model_id/default_thinking are
 * still on disk and still hold the writer's existing choice, so the first read
 * after deploy turns that pair into a real "Default" profile and points
 * default_profile_id at it. Only when the table is empty — once the writer has
 * profiles of their own, a null default is their business (they deleted one),
 * not a gap to fill.
 */
export async function getAppSettings(): Promise<AppSettings> {
  const db = await getDb()
  let row = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.id, 1))
    .limit(1)
    .then((rows) => rows[0])

  if (!row) {
    const defaults = {
      id: 1,
      defaultModelId: DEFAULT_GENERATION_SETTINGS.modelId,
      defaultThinking: DEFAULT_GENERATION_SETTINGS.thinking,
      defaultProfileId: null,
    }
    await db.insert(appSettings).values(defaults).onConflictDoNothing()
    row = defaults
  }

  if (row.defaultProfileId !== null) return toAppSettings(row)

  const existingProfile = await db
    .select({ id: modelProfiles.id })
    .from(modelProfiles)
    .limit(1)
    .then((rows) => rows[0])
  if (existingProfile) return toAppSettings(row)

  await db
    .insert(modelProfiles)
    .values({
      ...DEFAULT_GENERATION_SETTINGS,
      id: SEEDED_DEFAULT_PROFILE_ID,
      name: "Default",
      sortOrder: 0,
      modelId: row.defaultModelId,
      thinking: row.defaultThinking,
    })
    .onConflictDoNothing()
  await db
    .update(appSettings)
    .set({ defaultProfileId: SEEDED_DEFAULT_PROFILE_ID })
    .where(eq(appSettings.id, 1))

  return toAppSettings({ ...row, defaultProfileId: SEEDED_DEFAULT_PROFILE_ID })
}
