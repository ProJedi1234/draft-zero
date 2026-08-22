// lib/db/queries.ts — Read layer. Server-only: imported by server components
// and server actions. Every call reads fresh from Postgres (no caching layer).

import { and, asc, count, desc, eq, isNotNull, isNull, ne } from "drizzle-orm"

import { DEFAULT_GENERATION_SETTINGS } from "@/lib/mock-data"
import type {
  AppSettings,
  GenerationBaseline,
  LorebookEntry,
  ModelProfile,
  SettledCallStatus,
  Story,
  StoryRecap,
  StorySummary,
} from "@/lib/types"

import { getDb, type DrizzleDb } from "./client"
import { readHistoryState } from "./journal"
import type { EntryCost } from "./mappers"
import {
  toAppSettings,
  toGenerationDefaults,
  toLorebookEntry,
  toModelProfile,
  toStory,
  toStoryRecap,
  toStorySummary,
} from "./mappers"
import {
  appSettings,
  generationCalls,
  lorebookEntries,
  modelProfiles,
  storyEntries,
  storyRecaps,
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

/**
 * The story's summary version currently in force, or null when it has none.
 *
 * Eligibility is the whole rule: a version is only a candidate while the
 * passage it was written through is still LIVE — not soft-deleted, and still
 * the active take of its slot. That is what makes rewinding free. A rewind
 * soft-deletes its tail, so every version written against the abandoned branch
 * drops out of this query and the one before it takes over; undoing the rewind
 * restores those rows and the newer version comes straight back. No model call
 * on either leg, and nothing to journal.
 *
 * Ordered by coverage first and recency second. While summarization only ever
 * moves forward the two agree on every row, so the ordering is insurance rather
 * than logic — but it is the half that stays correct if a version is ever
 * written that covers less than one already stored, and ordering by recency
 * alone would silently prefer it.
 *
 * Exported because the writer path needs it too: deciding whether to summarize
 * starts with knowing how far the current version already reaches.
 */
export async function resolveStoryRecap(
  storyId: string
): Promise<StoryRecap | null> {
  const row = await storyRecapQuery(await getDb(), storyId).then(
    (rows) => rows[0]
  )
  return row ? toStoryRecap(row.recap) : null
}

/**
 * The statement itself, split out so it can be rendered and asserted without a
 * database. The liveness filter below is the whole feature and its absence
 * would be silent — see tests/story-recap-resolution.test.ts.
 */
export function storyRecapQuery(db: DrizzleDb, storyId: string) {
  return db
    .select({ recap: storyRecaps })
    .from(storyRecaps)
    .innerJoin(storyEntries, eq(storyEntries.id, storyRecaps.throughEntryId))
    .where(
      and(
        eq(storyRecaps.storyId, storyId),
        isNull(storyEntries.deletedAt),
        eq(storyEntries.isActive, true)
      )
    )
    .orderBy(desc(storyRecaps.throughPosition), desc(storyRecaps.createdAt))
    .limit(1)
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

  const [
    profileRow,
    entryRows,
    lorebookRows,
    history,
    recap,
    costRows,
    baseline,
  ] = await Promise.all([
    // Effective settings are resolved here, not stored: a followed story reads
    // its profile every time, so an edit in Settings reaches every follower
    // without touching a single story row. Skipped entirely for Custom.
    storyRow.profileId === null
      ? Promise.resolve(undefined)
      : db
          .select()
          .from(modelProfiles)
          .where(eq(modelProfiles.id, storyRow.profileId))
          .limit(1)
          .then((rows) => rows[0]),
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
    resolveStoryRecap(id),
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
    // Fetched for every story, followed or not: which of the two it is
    // depends on profile_id, and branching here would cost a round trip the
    // Promise.all is already paying for in parallel.
    getGenerationBaseline(),
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

  return toStory(
    storyRow,
    profileRow ?? null,
    entryRows,
    lorebookRows,
    history,
    recap?.text ?? "",
    baseline,
    costs
  )
}

/**
 * What every story and profile resolves against — the shared slider defaults
 * and the app-wide retention floor — read without the lazy seeding
 * getAppSettings does. A read path must not write, and the app's own constants
 * are the right answer in the one moment the settings row does not exist yet:
 * they are what the row is about to be created holding.
 */
export async function getGenerationBaseline(): Promise<GenerationBaseline> {
  const db = await getDb()
  const row = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.id, 1))
    .limit(1)
    .then((rows) => rows[0])
  return row
    ? { defaults: toGenerationDefaults(row), requireZdr: row.requireZdr }
    : { defaults: DEFAULT_GENERATION_SETTINGS, requireZdr: false }
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
 * How many stories follow each profile, keyed by profile id. Profiles nobody
 * follows are absent rather than zero — the settings list reads through a
 * default of 0, and one grouped count beats a query per row.
 *
 * Counted here rather than joined onto listModelProfiles because the switcher
 * has no use for it: only the editor, which warns that a save moves N stories.
 */
export async function countProfileFollowers(): Promise<Record<string, number>> {
  const db = await getDb()
  const rows = await db
    .select({ profileId: stories.profileId, followers: count() })
    .from(stories)
    .where(isNotNull(stories.profileId))
    .groupBy(stories.profileId)

  const counts: Record<string, number> = {}
  for (const row of rows) {
    if (row.profileId !== null) counts[row.profileId] = row.followers
  }
  return counts
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
      requireZdr: false,
      defaultTemperature: DEFAULT_GENERATION_SETTINGS.temperature,
      defaultTopP: DEFAULT_GENERATION_SETTINGS.topP,
      defaultMaxTokens: DEFAULT_GENERATION_SETTINGS.maxTokens,
      defaultLoreBudget: DEFAULT_GENERATION_SETTINGS.loreBudget,
      defaultContextWindow: DEFAULT_GENERATION_SETTINGS.contextWindow,
      defaultFrequencyPenalty: DEFAULT_GENERATION_SETTINGS.frequencyPenalty,
      defaultPresencePenalty: DEFAULT_GENERATION_SETTINGS.presencePenalty,
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
      id: SEEDED_DEFAULT_PROFILE_ID,
      name: "Default",
      sortOrder: 0,
      modelId: row.defaultModelId,
      thinking: row.defaultThinking,
      // Every slider left NULL: the seeded profile has no opinion of its own,
      // so it tracks the writer's Generation defaults from the first read.
    })
    .onConflictDoNothing()
  await db
    .update(appSettings)
    .set({ defaultProfileId: SEEDED_DEFAULT_PROFILE_ID })
    .where(eq(appSettings.id, 1))

  return toAppSettings({ ...row, defaultProfileId: SEEDED_DEFAULT_PROFILE_ID })
}
