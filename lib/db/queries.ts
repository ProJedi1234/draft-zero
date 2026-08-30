// lib/db/queries.ts — Read layer. Server-only: imported by server components
// and server actions. Every call reads fresh from Postgres (no caching layer).

import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  ilike,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm"

import { DEFAULT_GENERATION_SETTINGS } from "@/lib/mock-data"
import type {
  AppSettings,
  ComposerDraft,
  GalleryImage,
  GenerationBaseline,
  LorebookEntry,
  ModelProfile,
  SettledCallStatus,
  Story,
  StoryEntry,
  StoryRecap,
  StorySummary,
} from "@/lib/types"

import { CHARS_PER_TOKEN } from "@/lib/generation/context"
import { resolveGenerationSettings } from "@/lib/generation/resolve"

import type { StoryRecord } from "@/lib/store/records"
import { toStoryRecord } from "@/lib/store/records"

import { getDb, type DrizzleDb, type DrizzleTx } from "./client"
import { readHistoryState } from "./journal"
import type {
  EntryCost,
  ImageCost,
  ManuscriptWindow,
  SlotMeta,
} from "./mappers"
import {
  deriveSlotMeta,
  parseLoreIdsJson,
  toAppSettings,
  toGalleryImages,
  toGenerationDefaults,
  toGenerationSettings,
  toLorebookEntry,
  toModelProfile,
  toStory,
  toStoryEntry,
  toStoryRecap,
  toStorySummary,
  EXCERPT_CHARS,
  toExcerpt,
} from "./mappers"
import {
  appSettings,
  composerDrafts,
  generationCalls,
  lorebookEntries,
  modelProfiles,
  storyEntries,
  storyImages,
  storyRecaps,
  stories,
} from "./schema"

/** How many stories the sidebar asks for at a time. */
export const STORY_PAGE_SIZE = 20

/** One window of the library, plus whether the next one exists. */
export interface StoryPage {
  stories: StorySummary[]
  hasMore: boolean
}

/**
 * A window of stories, ordered updated_at DESC, optionally narrowed by a
 * search needle matched against title, genre and description.
 *
 * Paged rather than exhaustive because this runs on every request via the root
 * layout, and the sidebar only ever shows a screenful: an unbounded read put
 * the whole library into every RSC payload to render twenty rows. `hasMore`
 * comes from asking for one row more than the caller wants and throwing it
 * away — one query, no separate count.
 *
 * No word counts — the sidebar never shows them.
 */
export async function listStories(
  options: { limit?: number; offset?: number; query?: string } = {}
): Promise<StoryPage> {
  const { limit = STORY_PAGE_SIZE, offset = 0, query = "" } = options
  const db = await getDb()
  // Escape the LIKE metacharacters so a literal % or _ in the box searches for
  // itself rather than matching everything.
  const needle = query.trim().replace(/[\\%_]/g, "\\$&")
  const where =
    needle === ""
      ? undefined
      : or(
          ilike(stories.title, `%${needle}%`),
          ilike(stories.genre, `%${needle}%`),
          ilike(stories.description, `%${needle}%`)
        )
  const storyRows = await db
    .select()
    .from(stories)
    .where(where)
    .orderBy(desc(stories.updatedAt))
    .limit(limit + 1)
    .offset(offset)
  return {
    stories: storyRows.slice(0, limit).map((row) => toStorySummary(row)),
    hasMore: storyRows.length > limit,
  }
}

/**
 * Word count in SQL, matching countWords in mappers.ts (trim, split on
 * whitespace, blank is 0). Postgres `\s` is POSIX [[:space:]] where JS \s is
 * Unicode whitespace — close enough for a display-only figure.
 */
const entryWordCount = sql<string>`
  coalesce(sum(case
    when btrim(${storyEntries.text}) = '' then 0
    else array_length(regexp_split_to_array(btrim(${storyEntries.text}), '\\s+'), 1)
  end), 0)`

/**
 * The library grid's variant of listStories: the same rows plus a per-story
 * word count aggregated in Postgres. Only the rows actually in the manuscript
 * count — soft-deleted passages and the inactive takes of a retried slot are
 * still on disk and would otherwise inflate the number with prose the writer
 * cannot see. Aggregated here rather than in JS so the entry text never
 * leaves the database.
 */
export async function listStoriesWithCounts(): Promise<StorySummary[]> {
  const db = await getDb()
  const rows = await db
    .select({ story: stories, wordCount: entryWordCount })
    .from(stories)
    .leftJoin(
      storyEntries,
      and(
        eq(storyEntries.storyId, stories.id),
        isNull(storyEntries.deletedAt),
        eq(storyEntries.isActive, true)
      )
    )
    .groupBy(stories.id)
    .orderBy(desc(stories.updatedAt))
  return rows.map((row) => toStorySummary(row.story, Number(row.wordCount)))
}

/** Either handle — the snapshot route reads both story queries in one txn. */
type Handle = DrizzleDb | DrizzleTx

/** One story as the client store holds it, with its version. */
export interface StoryRecordRow {
  id: string
  version: string
  row: StoryRecord
}

/**
 * The client store's read of the library: the same rows and word-count
 * aggregate listStoriesWithCounts assembles, narrowed to one story or to what
 * has moved since a version the caller already holds.
 *
 * The narrowing is the point. The unfiltered aggregate scans every manuscript,
 * which is fine at boot and wrong on every phone wake — a `since` delta runs it
 * over the handful of stories that actually changed.
 */
export async function listStoryRecords(
  options: { storyId?: string; since?: string; tx?: Handle } = {}
): Promise<StoryRecordRow[]> {
  const db = options.tx ?? (await getDb())
  const where = options.storyId
    ? eq(stories.id, options.storyId)
    : options.since !== undefined
      ? gt(stories.updatedAt, options.since)
      : undefined
  const rows = await db
    .select({ story: stories, wordCount: entryWordCount })
    .from(stories)
    .leftJoin(
      storyEntries,
      and(
        eq(storyEntries.storyId, stories.id),
        isNull(storyEntries.deletedAt),
        eq(storyEntries.isActive, true)
      )
    )
    .where(where)
    .groupBy(stories.id)
    .orderBy(desc(stories.updatedAt))
  return rows.map((row) => ({
    id: row.story.id,
    version: row.story.updatedAt,
    row: toStoryRecord(row.story, Number(row.wordCount)),
  }))
}

/**
 * Every live story's id and version, and nothing else — the ground truth a
 * delta snapshot's deletion sweep is decided against. A single-table scan, on
 * purpose: it has to cover the whole library, so it must not carry the word
 * count aggregate with it.
 */
export async function listStoryIdVersions(
  tx?: Handle
): Promise<Array<{ id: string; version: string }>> {
  const db = tx ?? (await getDb())
  const rows = await db
    .select({ id: stories.id, version: stories.updatedAt })
    .from(stories)
  return rows
}

/**
 * The last thing that happened in each story, as prose — the front door's
 * Continue block and the excerpt line on every library row.
 *
 * The TAIL of the latest live passage rather than its head: this is the text a
 * writer is resuming *after*, and the opening of a passage they have already
 * read answers a question nobody asked. Truncation happens in Postgres, so a
 * hundred-thousand-word manuscript sends 360 characters over the wire.
 *
 * DISTINCT ON is doing the real work: one row per story, and `position DESC`
 * inside the story picks the newest. Live rows only, on both counts — a
 * soft-deleted tail or a superseded take is prose the canvas no longer shows,
 * and quoting it on the home screen would be quoting a rewind back at someone
 * who just undid it.
 */
export async function listStoryExcerpts(): Promise<Record<string, string>> {
  const db = await getDb()
  const rows = await db
    .selectDistinctOn([storyEntries.storyId], {
      storyId: storyEntries.storyId,
      tail: sql<string>`right(btrim(${storyEntries.text}), ${EXCERPT_CHARS})`,
      length: sql<number>`length(btrim(${storyEntries.text}))`,
    })
    .from(storyEntries)
    .where(and(isNull(storyEntries.deletedAt), eq(storyEntries.isActive, true)))
    .orderBy(storyEntries.storyId, desc(storyEntries.position))

  const excerpts: Record<string, string> = {}
  for (const row of rows) {
    const text = toExcerpt(row.tail, Number(row.length))
    if (text !== "") excerpts[row.storyId] = text
  }
  return excerpts
}

/**
 * Every illustration in the library, newest first, for the gallery's photo
 * wall — or the newest `limit` of them, which is the library's picture rail. The story join is for captions and grouping — title and tint are the
 * only pieces of a story the wall needs.
 *
 * Every live take, not just the active one, and toGalleryImages folds them into
 * one tile per slot. Deleted rows still never appear: `deleted_at` covers the
 * whole slot (deleteIllustration soft-deletes every take of a picture at once),
 * so "show the retries" and "show deleted pictures" stay the separate questions
 * they are.
 *
 * Ordering is left to toGalleryImages, which sorts by the slot's first take —
 * SQL cannot do it here without a window function over a set small enough that
 * one is not worth writing. The ORDER BY below is the in-slot one the mapper
 * depends on for `takes` to come out oldest-first.
 */
export async function listGalleryImages(
  options: { limit?: number } = {}
): Promise<GalleryImage[]> {
  const db = await getDb()
  const rows = await db
    .select({
      id: storyImages.id,
      prompt: storyImages.prompt,
      aspectRatio: storyImages.aspectRatio,
      mediaType: storyImages.mediaType,
      modelId: storyImages.modelId,
      seed: storyImages.seed,
      createdAt: storyImages.createdAt,
      imageGroupId: storyImages.imageGroupId,
      isActive: storyImages.isActive,
      storyId: storyImages.storyId,
      storyTitle: stories.title,
      tintHue: stories.tintHue,
      tintStrength: stories.tintStrength,
    })
    .from(storyImages)
    .innerJoin(stories, eq(storyImages.storyId, stories.id))
    .where(isNull(storyImages.deletedAt))
    .orderBy(asc(storyImages.imageIndex))
  const images = toGalleryImages(rows)
  // Sliced after folding rather than with a SQL LIMIT: a slot's takes have to
  // arrive together or the newest picture comes back missing its retries, and
  // "the newest N slots" is not a window SQL can take without ordering by
  // something this query deliberately leaves to the mapper. The rows carry no
  // image bytes — the media is a separate route — so the read this trims is a
  // metadata scan either way.
  return options.limit === undefined ? images : images.slice(0, options.limit)
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

/**
 * Slack past the composition budget when sizing the manuscript tail. The trim
 * anchor only ever moves FORWARD from `total - budget`, so budget chars of
 * tail strictly cover the window; the slack absorbs a retry composing with one
 * slot's prose filtered out and the paragraph-boundary cut, so neither ever
 * lands before the tail.
 */
const TAIL_SLACK_CHARS = 16384
/** The canvas floor: even a tiny context window still gets a real page. */
const MIN_TAIL_ENTRIES = 50

/**
 * A windowed manuscript read: the tail of the story's ACTIVE rows, sized to
 * cover the composition window (see charsBefore in lib/types.ts), plus the
 * aggregates describing everything it dropped.
 */
type ManuscriptRead = {
  rows: (typeof storyEntries.$inferSelect)[]
  slots: Map<string, SlotMeta>
  window: ManuscriptWindow | null
}

/** The one-row probe readManuscriptTail runs before fetching any text. */
type TailProbe = {
  total_count: number
  total_marked: number
  word_count: number
  first_gen: string | null
  last_gen: string | null
  window_start: number | null
  tail_count: number
  tail_marked: number
}

/**
 * Slot metadata for every retried slot of the story, aggregated so the
 * inactive takes' text never leaves the database. Story-wide rather than
 * filtered to a window: retried slots are rare, the group index covers this,
 * and the same map serves the tail read and pages of older passages alike.
 */
async function readSlotMeta(
  db: DrizzleDb,
  storyId: string
): Promise<Map<string, SlotMeta>> {
  const groupRows = await db
    .select({
      groupId: storyEntries.variantGroupId,
      indexes: sql<
        number[]
      >`array_agg(${storyEntries.variantIndex} order by ${storyEntries.variantIndex})`,
      activeIndex: sql<
        number | null
      >`max(${storyEntries.variantIndex}) filter (where ${storyEntries.isActive})`,
      namedProfiles: sql<number>`count(distinct ${storyEntries.genProfileName})::int`,
      hasUnnamed: sql<boolean>`bool_or(${storyEntries.genProfileName} is null)`,
    })
    .from(storyEntries)
    .where(
      and(eq(storyEntries.storyId, storyId), isNull(storyEntries.deletedAt))
    )
    .groupBy(storyEntries.variantGroupId)
    .having(sql`count(*) > 1`)

  const slots = new Map<string, SlotMeta>()
  for (const group of groupRows) {
    // A slot whose active take is deleted has no live passage to describe.
    if (group.activeIndex === null) continue
    slots.set(group.groupId, {
      index: group.indexes.indexOf(group.activeIndex),
      count: group.indexes.length,
      // Same semantics as slotProfilesMixed: a null profile name is its own
      // value, so it counts once beside the distinct named ones.
      profilesMixed: group.namedProfiles + (group.hasUnnamed ? 1 : 0) > 1,
    })
  }
  return slots
}

/** One page of older passages, walking backward from a window cursor. */
export type OlderEntriesPage = {
  /** Active takes, position ASC, variant metadata and costs filled. */
  entries: StoryEntry[]
  /** The new cursor: the first returned entry's position, for the next page. */
  windowStartPosition: number | null
  /** Whether more live entries exist before this page. */
  hasMore: boolean
}

/**
 * The `limit` live active entries immediately before `beforePosition`, in
 * manuscript order — the canvas' scroll-up read. Shaped exactly like the
 * tail's entries (same mapper, same slot metadata, same ledger lookup) so a
 * paged-in passage is indistinguishable from one that arrived with the story.
 */
export async function listOlderEntries(
  storyId: string,
  beforePosition: number,
  limit: number
): Promise<OlderEntriesPage> {
  const db = await getDb()
  const [rowsDesc, slots] = await Promise.all([
    db
      .select()
      .from(storyEntries)
      .where(
        and(
          eq(storyEntries.storyId, storyId),
          isNull(storyEntries.deletedAt),
          eq(storyEntries.isActive, true),
          lt(storyEntries.position, beforePosition)
        )
      )
      .orderBy(desc(storyEntries.position))
      // One past the page answers hasMore without a second count query.
      .limit(limit + 1),
    readSlotMeta(db, storyId),
  ])

  const hasMore = rowsDesc.length > limit
  const rows = rowsDesc.slice(0, limit).reverse()

  const costRows =
    rows.length === 0
      ? []
      : await db
          .select({
            storyEntryId: generationCalls.storyEntryId,
            costUsd: generationCalls.costUsd,
            reasoningTokens: generationCalls.reasoningTokens,
            status: generationCalls.status,
          })
          .from(generationCalls)
          .where(
            and(
              eq(generationCalls.storyId, storyId),
              inArray(
                generationCalls.storyEntryId,
                rows.map((row) => row.id)
              ),
              ne(generationCalls.status, "streaming")
            )
          )
  const costs = new Map<string, EntryCost>()
  for (const row of costRows) {
    if (row.storyEntryId === null) continue
    costs.set(row.storyEntryId, {
      costUsd: row.costUsd,
      reasoningTokens: row.reasoningTokens,
      status: row.status as SettledCallStatus,
    })
  }

  return {
    entries: rows.map((row) =>
      toStoryEntry(
        row,
        slots.get(row.variantGroupId) ?? {
          index: 0,
          count: 1,
          profilesMixed: false,
        },
        costs.get(row.id) ?? null
      )
    ),
    windowStartPosition: rows[0]?.position ?? null,
    hasMore,
  }
}

async function readManuscriptTail(
  db: DrizzleDb,
  id: string,
  contextWindow: number
): Promise<ManuscriptRead> {
  const need = contextWindow * CHARS_PER_TOKEN + TAIL_SLACK_CHARS

  // `ml` is one live row's cost in the manuscript, measured in UTF-16 units
  // the way JS .length measures them — char_length counts codepoints, so the
  // astral-plane characters the second term counts are worth two each — plus
  // the "> " player-turn marker and a "\n\n" separator share. These numbers
  // become charsBefore, and charsBefore feeds the trim anchor: if they drift
  // from manuscriptWithOffsets by a single unit, prompts change bytes and
  // caches quietly stop hitting. The dev assertion below and
  // tests/context-window-equivalence.test.ts are the tripwires.
  //
  // The probe reads no text out: it ranks live rows newest-first, keeps rows
  // until their running length covers the composition budget (or the canvas
  // floor), and returns only offsets and aggregates. The text of the kept rows
  // arrives in the follow-up query.
  const probe = await db.execute(sql`
    with live as (
      select "position", "source", "created_at", "text",
        char_length("text")
          + (char_length("text")
             - char_length(regexp_replace("text", '[\\U00010000-\\U0010FFFF]', '', 'g')))
          + (case when "action_kind" is not null then 2 else 0 end)
          + 2 as ml
      from "story_entries"
      where "story_id" = ${id} and "deleted_at" is null and "is_active"
    ),
    ranked as (
      select "position", ml,
        sum(ml) over (order by "position" desc) as csum,
        row_number() over (order by "position" desc) as rn
      from live
    ),
    tail as (
      select * from ranked where csum - ml < ${need} or rn <= ${MIN_TAIL_ENTRIES}
    )
    select
      (select count(*)::int from live) as total_count,
      (select coalesce(sum(ml), 0)::int from live) as total_marked,
      (select coalesce(sum(case
          when btrim("text") = '' then 0
          else array_length(regexp_split_to_array(btrim("text"), '\\s+'), 1)
        end), 0)::int from live) as word_count,
      (select min("created_at") from live where "source" = 'generated') as first_gen,
      (select max("created_at") from live where "source" = 'generated') as last_gen,
      (select min("position")::int from tail) as window_start,
      (select count(*)::int from tail) as tail_count,
      (select coalesce(max(csum), 0)::int from tail) as tail_marked
  `)
  const stats = probe.rows[0] as unknown as TailProbe

  const [rows, slots] = await Promise.all([
    stats.window_start === null
      ? Promise.resolve([])
      : db
          .select()
          .from(storyEntries)
          .where(
            and(
              eq(storyEntries.storyId, id),
              isNull(storyEntries.deletedAt),
              eq(storyEntries.isActive, true),
              gte(storyEntries.position, stats.window_start)
            )
          )
          .orderBy(asc(storyEntries.position)),
    readSlotMeta(db, id),
  ])

  const entriesBefore = stats.total_count - stats.tail_count
  const charsBefore = stats.total_marked - stats.tail_marked

  if (process.env.NODE_ENV !== "production") {
    // The SQL length arithmetic above must agree with manuscriptWithOffsets'
    // joining to the UTF-16 unit — see the ml comment. Cheap to check here,
    // impossible to notice anywhere else.
    let tailMarked = 0
    for (const row of rows)
      tailMarked += row.text.length + (row.actionKind !== null ? 2 : 0) + 2
    const fullLength = stats.total_marked === 0 ? 0 : stats.total_marked - 2
    const tailLength = rows.length === 0 ? 0 : tailMarked - 2
    if (charsBefore + tailLength !== fullLength)
      throw new Error(
        `manuscript window arithmetic drifted: ${charsBefore} + ${tailLength} != ${fullLength} (story ${id})`
      )
  }

  return {
    rows,
    slots,
    window: {
      entriesBefore,
      charsBefore,
      hasMoreBefore: entriesBefore > 0,
      windowStartPosition: stats.window_start,
      wordCount: stats.word_count,
      generatedSpan:
        stats.first_gen !== null && stats.last_gen !== null
          ? { firstIso: stats.first_gen, lastIso: stats.last_gen }
          : null,
    },
  }
}

/** Every non-deleted row, active takes and alternatives alike — the old shape. */
async function readFullManuscript(
  db: DrizzleDb,
  id: string
): Promise<ManuscriptRead> {
  const allRows = await db
    .select()
    .from(storyEntries)
    .where(and(eq(storyEntries.storyId, id), isNull(storyEntries.deletedAt)))
    .orderBy(asc(storyEntries.position), asc(storyEntries.variantIndex))
  return {
    rows: allRows.filter((row) => row.isActive),
    slots: deriveSlotMeta(allRows),
    window: null,
  }
}

/**
 * Full story with settings, computed wordCount + activeLorebookEntryIds — and,
 * by default, only a TAIL of the manuscript: enough entries to cover the
 * composition window plus slack, and never fewer than MIN_TAIL_ENTRIES. The
 * window fields on the result (entriesBefore/charsBefore, see lib/types.ts)
 * are what keep composeContext byte-identical to the full read; the canvas
 * pages older passages in on demand.
 *
 * `full: true` loads the whole manuscript — for the consumers whose job is the
 * prose that has fallen OUT of the window (the summarizer) or an arbitrary
 * prefix of it (the context viewer).
 */
export async function getStory(
  id: string,
  opts: { full?: boolean } = {}
): Promise<Story | null> {
  const db = await getDb()
  const storyRow = await db
    .select()
    .from(stories)
    .where(eq(stories.id, id))
    .limit(1)
    .then((rows) => rows[0])

  if (!storyRow) return null

  // Resolved BEFORE the manuscript read, because the tail is sized from the
  // effective context window — which lives on the followed profile, not
  // necessarily on the story row.
  const [profileRow, baseline] = await Promise.all([
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
    getGenerationBaseline(),
  ])
  const effective = resolveGenerationSettings(
    toGenerationSettings(storyRow),
    profileRow ? toModelProfile(profileRow) : null,
    baseline
  )

  const [
    manuscript,
    imageRows,
    lorebookRows,
    history,
    recap,
    costRows,
    imageCostRows,
  ] = await Promise.all([
    opts.full
      ? readFullManuscript(db, id)
      : readManuscriptTail(db, id, effective.contextWindow),
    // Every non-deleted illustration, alternatives included: toStory derives
    // imageIndex/imageCount from the whole slot, and a query that returned
    // only the active take could not tell a picture that has been retried
    // twice from one that never has. All of them, not just the window's —
    // pictures are few, and a windowed read would drop the beats above the
    // fold.
    db
      .select()
      .from(storyImages)
      .where(and(eq(storyImages.storyId, id), isNull(storyImages.deletedAt)))
      .orderBy(asc(storyImages.imageIndex)),
    db.select().from(lorebookEntries).where(eq(lorebookEntries.storyId, id)),
    readHistoryState(db, id),
    resolveStoryRecap(id),
    // The story's spend, as a second small SELECT rather than a join onto the
    // entries above. A join is the same rows, but a ledger that somehow held
    // two calls for one take would silently DUPLICATE a passage in the
    // manuscript — a bookkeeping oddity has no business being able to do
    // that. Indexed on (story_id, created_at); in-flight calls are excluded
    // because they have no cost yet and no take.
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
    // The same read for pictures — see the imageCosts map below. A separate
    // SELECT rather than a UNION: they key by different columns, and an
    // image billed per megapixel has no business being summed with a
    // passage billed per token.
    db
      .select({
        storyImageId: generationCalls.storyImageId,
        origImageGroupId: generationCalls.origImageGroupId,
        costUsd: generationCalls.costUsd,
        status: generationCalls.status,
      })
      .from(generationCalls)
      .where(
        and(
          eq(generationCalls.storyId, id),
          isNotNull(generationCalls.storyImageId),
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

  const imageCosts = new Map<string, ImageCost>()
  // Slot totals, summed with the ledger's own decimal arithmetic rather than in
  // JS: Number() on a numeric(20,12) is exactly the rounding this codebase
  // refuses everywhere else money is added up.
  const slotRows = await (async () => {
    const groups = [
      ...new Set(
        imageCostRows
          .map((row) => row.origImageGroupId)
          .filter((group): group is string => group !== null)
      ),
    ]
    if (groups.length === 0) return []
    return db
      .select({
        group: generationCalls.origImageGroupId,
        total: sql<string>`SUM(${generationCalls.costUsd})`,
        unpriced: sql<number>`COUNT(*) FILTER (WHERE ${generationCalls.costUsd} IS NULL)`,
      })
      .from(generationCalls)
      .where(
        and(
          eq(generationCalls.storyId, id),
          inArray(generationCalls.origImageGroupId, groups),
          ne(generationCalls.status, "streaming")
        )
      )
      .groupBy(generationCalls.origImageGroupId)
  })()

  const slotTotals = new Map(
    slotRows.map((row) => [
      row.group ?? "",
      { total: row.total, unpriced: Number(row.unpriced) },
    ])
  )

  for (const row of imageCostRows) {
    if (row.storyImageId === null) continue
    const slot = slotTotals.get(row.origImageGroupId ?? "")
    imageCosts.set(row.storyImageId, {
      costUsd: row.costUsd,
      status: row.status as SettledCallStatus,
      slotCostUsd: slot?.total ?? row.costUsd,
      slotUnpricedCalls: slot?.unpriced ?? 0,
    })
  }

  return toStory(
    storyRow,
    profileRow ?? null,
    manuscript.rows,
    manuscript.slots,
    imageRows,
    lorebookRows,
    history,
    recap?.text ?? "",
    baseline,
    costs,
    imageCosts,
    manuscript.window
  )
}

/**
 * The whole manuscript, for the consumers that genuinely need prose from
 * before the window: the summarizer and the per-entry context viewer.
 */
export function getStoryFull(id: string): Promise<Story | null> {
  return getStory(id, { full: true })
}

/** Just the title, for generateMetadata — no reason to load a manuscript. */
/**
 * The composer's unsent state for one story, or null when its composer was
 * never touched — the seed for the workspace's live draft state. Read once
 * per story open; live updates travel as `draft` bus events, never through a
 * refetch of this.
 */
export async function getComposerDraft(
  storyId: string
): Promise<ComposerDraft | null> {
  const db = await getDb()
  const row = await db
    .select()
    .from(composerDrafts)
    .where(eq(composerDrafts.storyId, storyId))
    .limit(1)
    .then((rows) => rows[0])
  return row
    ? {
        text: row.text,
        mode: row.mode,
        imagePrompt: row.imagePrompt,
        imageAssisted: row.imageAssisted,
        imageStyle: row.imageStyle,
        imageExcludedLoreIds: parseLoreIdsJson(row.imageExcludedLoreJson),
        updatedAt: row.updatedAt,
      }
    : null
}

export async function getStoryTitle(id: string): Promise<string | null> {
  const db = await getDb()
  const row = await db
    .select({ title: stories.title })
    .from(stories)
    .where(eq(stories.id, id))
    .limit(1)
    .then((rows) => rows[0])
  return row?.title ?? null
}

/**
 * The two fields the image route needs to find an illustration's bytes.
 *
 * Deliberately narrow, and deliberately NOT filtered by deleted_at or is_active:
 * this answers "what are these bytes", which stays true of a picture the writer
 * deleted a second ago and may undo. Access control is not a concern the route
 * has — every surface of this app already reads every story.
 */
export async function getStoryImageMedia(
  imageId: string
): Promise<{ mediaType: string } | null> {
  const db = await getDb()
  const row = await db
    .select({ mediaType: storyImages.mediaType })
    .from(storyImages)
    .where(eq(storyImages.id, imageId))
    .limit(1)
    .then((rows) => rows[0])
  return row ?? null
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

/* -------------------------------------------------------------------------- */
/* Manuscript positions — the handle every MCP tool takes.                    */
/*                                                                            */
/* `story_entries.position` and `story_images.position` draw from one         */
/* per-story counter, so "the manuscript" is both tables read together and    */
/* "live" always means the active take, not soft-deleted. These live here     */
/* rather than in a tool file because five tools need them and three needed   */
/* the same one: read/story_map share the bounds, edit/rewind share the       */
/* position lookup, and list_stories/delete_story share the passage count.    */
/* -------------------------------------------------------------------------- */

/** Passage rows that are the rendered take and not soft-deleted. */
function livePassages(storyId: string) {
  return and(
    eq(storyEntries.storyId, storyId),
    eq(storyEntries.isActive, true),
    isNull(storyEntries.deletedAt)
  )
}

/** Image rows on the same terms. */
function liveImages(storyId: string) {
  return and(
    eq(storyImages.storyId, storyId),
    eq(storyImages.isActive, true),
    isNull(storyImages.deletedAt)
  )
}

/**
 * A story's live position range across both slot-bearing tables.
 *
 * `empty` comes back as `first: 0, last: -1` on purpose: that is exactly the
 * `last < first` shape the MCP range resolver already treats as an empty
 * story, so a caller needs no special case for a story with nothing in it.
 */
export async function getManuscriptBounds(
  storyId: string
): Promise<{ first: number; last: number; empty: boolean }> {
  const db = await getDb()
  const [entryBounds, imageBounds] = await Promise.all([
    db
      .select({
        min: sql<number | null>`min(${storyEntries.position})`,
        max: sql<number | null>`max(${storyEntries.position})`,
      })
      .from(storyEntries)
      .where(livePassages(storyId))
      .then((rows) => rows[0]),
    db
      .select({
        min: sql<number | null>`min(${storyImages.position})`,
        max: sql<number | null>`max(${storyImages.position})`,
      })
      .from(storyImages)
      .where(liveImages(storyId))
      .then((rows) => rows[0]),
  ])

  const mins = [entryBounds?.min, imageBounds?.min].filter(isNumber)
  const maxs = [entryBounds?.max, imageBounds?.max].filter(isNumber)
  if (mins.length === 0) return { first: 0, last: -1, empty: true }
  return { first: Math.min(...mins), last: Math.max(...maxs), empty: false }
}

function isNumber(value: number | null | undefined): value is number {
  return value !== null && value !== undefined
}

/** One slot of the manuscript. `text` is the prose, or an image's prompt. */
export interface ManuscriptSlot {
  position: number
  kind: "narration" | "say" | "do" | "image"
  text: string
}

/**
 * Both tables' live rows inside an inclusive position window, merged and
 * sorted into reading order. The caller decides how to render an image slot;
 * this returns its prompt untouched.
 *
 * `limit` is a row count and `take` says which end of the window it counts
 * from — positions are not dense in live rows, so a window is never a
 * trustworthy proxy for how many rows sit in it. Bounding the selects here
 * rather than in the caller means no tool can ask for an unbounded manuscript.
 */
export async function readManuscriptWindow(
  storyId: string,
  from: number,
  to: number,
  limit: number,
  take: "head" | "tail" = "head"
): Promise<ManuscriptSlot[]> {
  if (to < from || limit < 1) return []
  const db = await getDb()
  // The limit is applied per table and again after the merge: `limit` rows
  // from each side always contain the true first (or last) `limit` rows of
  // their union, and neither select can be asked for a whole manuscript.
  const order = take === "tail" ? desc : asc
  const [passageRows, imageRows] = await Promise.all([
    db
      .select({
        position: storyEntries.position,
        actionKind: storyEntries.actionKind,
        text: storyEntries.text,
      })
      .from(storyEntries)
      .where(
        and(
          livePassages(storyId),
          gte(storyEntries.position, from),
          lte(storyEntries.position, to)
        )
      )
      .orderBy(order(storyEntries.position))
      .limit(limit),
    db
      .select({ position: storyImages.position, prompt: storyImages.prompt })
      .from(storyImages)
      .where(
        and(
          liveImages(storyId),
          gte(storyImages.position, from),
          lte(storyImages.position, to)
        )
      )
      .orderBy(order(storyImages.position))
      .limit(limit),
  ])

  const slots = [
    ...passageRows.map((row): ManuscriptSlot => ({
      position: row.position,
      kind: row.actionKind ?? "narration",
      text: row.text,
    })),
    ...imageRows.map((row): ManuscriptSlot => ({
      position: row.position,
      kind: "image",
      text: row.prompt,
    })),
  ].sort((a, b) => a.position - b.position)

  return take === "tail" ? slots.slice(-limit) : slots.slice(0, limit)
}

/**
 * The live passage in a slot, if a passage is what sits there. A slot holding
 * an image, a retired take, or nothing at all reads as null — which is the
 * answer `edit` and `rewind` both turn into "no passage at that position".
 */
export async function getLivePassageAtPosition(
  storyId: string,
  position: number
): Promise<{ id: string; text: string } | null> {
  const db = await getDb()
  const row = await db
    .select({ id: storyEntries.id, text: storyEntries.text })
    .from(storyEntries)
    .where(and(livePassages(storyId), eq(storyEntries.position, position)))
    .limit(1)
    .then((rows) => rows[0])
  return row ?? null
}

/** Live passages a rewind to `position` would retire. */
export async function countLivePassagesAfter(
  storyId: string,
  position: number
): Promise<number> {
  const db = await getDb()
  const row = await db
    .select({ n: count() })
    .from(storyEntries)
    .where(and(livePassages(storyId), gt(storyEntries.position, position)))
    .then((rows) => rows[0])
  return row?.n ?? 0
}

/** Live passages in one story — the number `delete_story` puts in its prompt. */
export async function countLivePassages(storyId: string): Promise<number> {
  const db = await getDb()
  const row = await db
    .select({ n: count() })
    .from(storyEntries)
    .where(livePassages(storyId))
    .then((rows) => rows[0])
  return row?.n ?? 0
}

/**
 * Live passage counts for every story at once, keyed by id.
 *
 * `listStoriesWithCounts` aggregates words for the library grid and has no
 * reason to also count rows; the MCP index wants both, so it asks for this
 * alongside rather than making every page of the app pay for a second
 * aggregate.
 */
export async function countLivePassagesByStory(): Promise<Map<string, number>> {
  const db = await getDb()
  const rows = await db
    .select({ storyId: storyEntries.storyId, n: count() })
    .from(storyEntries)
    .where(and(eq(storyEntries.isActive, true), isNull(storyEntries.deletedAt)))
    .groupBy(storyEntries.storyId)
  return new Map(rows.map((row) => [row.storyId, row.n]))
}

/* -------------------------------------------------------------------------- */
/* Search — owned by the MCP search-lore bundle (lib/mcp/tools/search.ts).   */
/* -------------------------------------------------------------------------- */

/** Bounds a single search call — this app is single-user/LAN, not a corpus. */
const SEARCH_ROW_CAP = 500

/** Escapes LIKE metacharacters, matching listStories' needle handling. */
export function escapeLikeNeedle(query: string): string {
  return query.trim().replace(/[\\%_]/g, "\\$&")
}

export interface EntryMatch {
  storyId: string
  storyTitle: string
  position: number
  text: string
}

/**
 * Live, active passages whose text matches `needle` (already LIKE-escaped),
 * case-insensitive. Scoped to one story when given, otherwise every story —
 * soft-deleted and inactive-take text never surfaces here, same visibility
 * rule as the manuscript reads.
 */
export async function searchStoryEntries(
  needle: string,
  storyId?: string
): Promise<EntryMatch[]> {
  const db = await getDb()
  const rows = await db
    .select({
      storyId: storyEntries.storyId,
      storyTitle: stories.title,
      position: storyEntries.position,
      text: storyEntries.text,
    })
    .from(storyEntries)
    .innerJoin(stories, eq(storyEntries.storyId, stories.id))
    .where(
      and(
        isNull(storyEntries.deletedAt),
        eq(storyEntries.isActive, true),
        ilike(storyEntries.text, `%${needle}%`),
        storyId === undefined ? undefined : eq(storyEntries.storyId, storyId)
      )
    )
    .orderBy(asc(storyEntries.storyId), asc(storyEntries.position))
    .limit(SEARCH_ROW_CAP)
  return rows
}

export interface LoreMatch {
  id: string
  storyId: string
  storyTitle: string
  name: string
  content: string
}

/**
 * Lorebook entries whose name or content matches `needle` (already
 * LIKE-escaped), case-insensitive. Scoped to one story when given. Matches
 * regardless of `enabled` — search is for finding an entry to read or edit,
 * not a preview of what is currently triggerable.
 */
export async function searchLorebookContent(
  needle: string,
  storyId?: string
): Promise<LoreMatch[]> {
  const db = await getDb()
  const pattern = `%${needle}%`
  const rows = await db
    .select({
      id: lorebookEntries.id,
      storyId: lorebookEntries.storyId,
      storyTitle: stories.title,
      name: lorebookEntries.name,
      content: lorebookEntries.content,
    })
    .from(lorebookEntries)
    .innerJoin(stories, eq(lorebookEntries.storyId, stories.id))
    .where(
      and(
        or(
          ilike(lorebookEntries.name, pattern),
          ilike(lorebookEntries.content, pattern)
        ),
        storyId === undefined ? undefined : eq(lorebookEntries.storyId, storyId)
      )
    )
    .orderBy(asc(lorebookEntries.storyId), asc(lorebookEntries.name))
    .limit(SEARCH_ROW_CAP)
  return rows
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
      // Null, not the built-in id: the install follows whatever the app thinks
      // the right summarizer is rather than freezing today's answer.
      summaryModelId: null,
      summaryThinking: "off" as const,
      summaryProviderTag: null,
      summaryZdr: false,
      summaryTemperature: 0.3,
      // Null on purpose — see the column comments: the derived rules are the
      // defaults, and a concrete number is the override.
      summaryTargetWords: null,
      summaryMaxTokens: null,
      // Null for the same reason the summarizer's is.
      atmosphereModelId: null,
      atmosphereThinking: "off" as const,
      atmosphereProviderTag: null,
      atmosphereZdr: false,
      atmosphereTemperature: 0.2,
      atmosphereMaxTokens: 2048,
      atmospherePassagesBetweenChecks: 3,
      requireZdr: false,
      // Null follows the catalog's first eligible entry; 4,096 is the shipped
      // derivation budget — see app/api/image-prompt/route.ts for the why.
      defaultImageModelId: null,
      imageContextTokens: 4096,
      defaultTemperature: DEFAULT_GENERATION_SETTINGS.temperature,
      defaultTopP: DEFAULT_GENERATION_SETTINGS.topP,
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

/* -------------------------------------------------------------------------- */
/* Usage aggregation — owned by the `usage` MCP tool                          */
/* -------------------------------------------------------------------------- */

/** How `getUsageAggregate` buckets its rows. */
export type UsageGroupBy = "model" | "requestKind" | "day" | "story"

export interface UsageGroupRow {
  /** The model id, request kind, `YYYY-MM-DD` day, or story title. */
  key: string
  calls: number
  /** Summed cost, USD — kept as the numeric column's own string so a report
   * built from many fractional-cent calls never drifts. */
  costUsd: string
  /**
   * Calls in this bucket that were never priced. `cost_usd` is NULL until
   * known and stays NULL on a call nothing ever priced, so `costUsd` is a
   * floor whenever this is above zero — the same rule lib/db/cost-queries.ts
   * states in its header, carried here so a report cannot present an
   * undercount as exact.
   */
  unpricedCalls: number
  promptTokens: number
  completionTokens: number
  reasoningTokens: number
  /** Subset of promptTokens the provider reported as cache hits. */
  cachedPromptTokens: number
}

export interface UsageAggregate {
  groups: UsageGroupRow[]
  totals: Omit<UsageGroupRow, "key">
}

const ZERO_USAGE_TOTALS: Omit<UsageGroupRow, "key"> = {
  calls: 0,
  costUsd: "0",
  unpricedCalls: 0,
  promptTokens: 0,
  completionTokens: 0,
  reasoningTokens: 0,
  cachedPromptTokens: 0,
}

const usageSettled = ne(generationCalls.status, "streaming")

const usageCostUsd = sql<string>`coalesce(sum(${generationCalls.costUsd}), 0)::text`
const usageCalls = sql<number>`count(*)::int`
const usageUnpricedCalls = sql<number>`count(*) filter (where ${generationCalls.costUsd} is null)::int`
const usagePromptTokens = sql<number>`coalesce(sum(${generationCalls.promptTokens}), 0)::int`
const usageCompletionTokens = sql<number>`coalesce(sum(${generationCalls.completionTokens}), 0)::int`
const usageReasoningTokens = sql<number>`coalesce(sum(${generationCalls.reasoningTokens}), 0)::int`
const usageCachedPromptTokens = sql<number>`coalesce(sum(${generationCalls.cachedPromptTokens}), 0)::int`

/**
 * The day a call landed, as `YYYY-MM-DD` off its raw ISO `created_at` text —
 * UTC, not the writer's local zone. Good enough for a spend-shape report; a
 * local-time bucket would need the zone this single-user LAN server has no
 * request-scoped notion of (see `zonedDayStart` in cost-queries.ts, which
 * takes one explicitly from the client).
 */
const usageDayKey = sql<string>`substring(${generationCalls.createdAt} from 1 for 10)`

/**
 * Spend and token splits over `generation_calls`, grouped one of four ways and
 * optionally scoped to a story and/or an inclusive `createdAt` window.
 *
 * Kept apart from `lib/db/cost-queries.ts`: that module is a fixed set of
 * shapes the app's own cost UI reads (today/week/all-time, per story, per
 * model); this is the one flexible aggregate the `usage` MCP tool needs and
 * nothing there matches its groupBy/window combination. `story` grouping keys
 * on `orig_story_id`, the same FK-free copy `getSpendByStory` uses, so a
 * deleted story keeps its own line instead of merging into one NULL group.
 */
export async function getUsageAggregate(options: {
  storyId?: string
  groupBy?: UsageGroupBy
  since?: string
  until?: string
}): Promise<UsageAggregate> {
  const db = await getDb()
  const { storyId, groupBy = "model", since, until } = options

  const scope = and(
    usageSettled,
    storyId ? eq(generationCalls.storyId, storyId) : undefined,
    since ? sql`${generationCalls.createdAt} >= ${since}` : undefined,
    until ? sql`${generationCalls.createdAt} <= ${until}` : undefined
  )

  const groups: UsageGroupRow[] =
    groupBy === "story"
      ? await db
          .select({
            key: sql<string>`coalesce(${stories.title}, max(${generationCalls.storyTitle}), 'Deleted story')`,
            calls: usageCalls,
            costUsd: usageCostUsd,
            unpricedCalls: usageUnpricedCalls,
            promptTokens: usagePromptTokens,
            completionTokens: usageCompletionTokens,
            reasoningTokens: usageReasoningTokens,
            cachedPromptTokens: usageCachedPromptTokens,
          })
          .from(generationCalls)
          .leftJoin(stories, eq(stories.id, generationCalls.storyId))
          .where(scope)
          .groupBy(generationCalls.origStoryId, stories.id, stories.title)
          .orderBy(sql`sum(${generationCalls.costUsd}) desc nulls last`)
      : await db
          .select({
            key:
              groupBy === "model"
                ? generationCalls.modelId
                : groupBy === "requestKind"
                  ? generationCalls.requestKind
                  : usageDayKey,
            calls: usageCalls,
            costUsd: usageCostUsd,
            unpricedCalls: usageUnpricedCalls,
            promptTokens: usagePromptTokens,
            completionTokens: usageCompletionTokens,
            reasoningTokens: usageReasoningTokens,
            cachedPromptTokens: usageCachedPromptTokens,
          })
          .from(generationCalls)
          .where(scope)
          .groupBy(
            groupBy === "model"
              ? generationCalls.modelId
              : groupBy === "requestKind"
                ? generationCalls.requestKind
                : usageDayKey
          )
          .orderBy(sql`sum(${generationCalls.costUsd}) desc nulls last`)

  const totals = await db
    .select({
      calls: usageCalls,
      costUsd: usageCostUsd,
      unpricedCalls: usageUnpricedCalls,
      promptTokens: usagePromptTokens,
      completionTokens: usageCompletionTokens,
      reasoningTokens: usageReasoningTokens,
      cachedPromptTokens: usageCachedPromptTokens,
    })
    .from(generationCalls)
    .where(scope)
    .then((rows) => rows[0])

  return { groups, totals: totals ?? ZERO_USAGE_TOTALS }
}
