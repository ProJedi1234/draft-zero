// lib/db/cost-queries.ts — Read layer for the spend ledger.
//
// Kept apart from lib/db/queries.ts because these are aggregates over
// generation_calls rather than reads of the manuscript, and because every cost
// surface in the app imports from exactly one place.
//
// Two rules hold in every query here:
//
//   1. `status <> 'streaming'` — a call still in flight has no cost yet, and a
//      row orphaned by a dead process would otherwise sit in a total forever.
//   2. Money is summed IN SQL and cast to text. It never becomes a JS number.
//      Per-call prices carry eight or nine decimal places and the whole point of
//      the ledger is that a few thousand of them add up to a figure the writer
//      compares against a credit balance; a float would drift in exactly the
//      digit being checked.
//
// NULL and 0 are different answers everywhere below. NULL is "OpenRouter never
// priced this call"; the counts of those rows come back beside every total so
// the UI can say "$0.42+" instead of presenting an undercount as exact.

import { and, asc, eq, isNull, ne, sql } from "drizzle-orm"

import { zonedDayStart } from "@/lib/time-zone"
import type {
  EntrySpendRow,
  GlobalCostSummary,
  ModelShareRow,
  ModelSpendRow,
  SpendDay,
  StoryCostProfile,
  StorySpendRow,
} from "@/lib/types"

import { getDb } from "./client"
import { generationCalls, storyEntries, stories } from "./schema"

/** Rows that have resolved — the only ones any figure is built from. */
const settled = ne(generationCalls.status, "streaming")

/** `coalesce(sum(cost_usd), 0)::text` — the house total. */
const totalUsd = sql<string>`coalesce(sum(${generationCalls.costUsd}), 0)::text`

const callCount = sql<number>`count(*)::int`

const unpricedCount = sql<number>`count(*) filter (where ${generationCalls.costUsd} is null)::int`

/**
 * A calendar day key from an ISO-8601 `text` timestamp, bucketed in `timeZone`.
 *
 * Bucketing needs a real conversion, so unlike everything else in this module
 * it cannot stay on the raw text. Only the GROUP BY pays: the range predicates
 * still compare plain ISO strings, so the (created_at) index scans and this
 * runs over rows already narrowed to the window.
 */
function dayKey(timeZone: string) {
  return sql<string>`to_char(${generationCalls.createdAt}::timestamptz at time zone ${timeZone}::text, 'YYYY-MM-DD')`
}

/**
 * Everything the story-header ledger shows, in three round trips.
 *
 * `perEntry` is the sparkline's data and is deliberately LEFT-joined from the
 * manuscript side: a passage with no ledger row (imported, pre-ledger, or from
 * a call the recorder missed) is a point with an unknown cost, not a point at
 * zero and not a missing point.
 */
export async function getStoryCostProfile(
  storyId: string
): Promise<StoryCostProfile> {
  const db = await getDb()
  const scope = and(eq(generationCalls.storyId, storyId), settled)

  const [totals, perModel, perEntry] = await Promise.all([
    db
      .select({
        totalUsd,
        calls: callCount,
        unpricedCalls: unpricedCount,
        abortedCalls: sql<number>`count(*) filter (where ${generationCalls.status} = 'aborted')::int`,
        promptTokens: sql<number>`coalesce(sum(${generationCalls.promptTokens}), 0)::int`,
        completionTokens: sql<number>`coalesce(sum(${generationCalls.completionTokens}), 0)::int`,
      })
      .from(generationCalls)
      .where(scope)
      .then((rows) => rows[0]),
    db
      .select({
        modelId: generationCalls.modelId,
        costUsd: totalUsd,
        calls: callCount,
      })
      .from(generationCalls)
      .where(scope)
      .groupBy(generationCalls.modelId)
      .orderBy(sql`sum(${generationCalls.costUsd}) desc nulls last`),
    db
      .select({
        entryId: storyEntries.id,
        position: storyEntries.position,
        costUsd: generationCalls.costUsd,
      })
      .from(storyEntries)
      .leftJoin(
        generationCalls,
        and(eq(generationCalls.storyEntryId, storyEntries.id), settled)
      )
      .where(
        and(
          eq(storyEntries.storyId, storyId),
          isNull(storyEntries.deletedAt),
          eq(storyEntries.isActive, true),
          eq(storyEntries.source, "generated")
        )
      )
      .orderBy(asc(storyEntries.position)),
  ])

  return {
    totalUsd: totals?.totalUsd ?? "0",
    calls: totals?.calls ?? 0,
    unpricedCalls: totals?.unpricedCalls ?? 0,
    abortedCalls: totals?.abortedCalls ?? 0,
    promptTokens: totals?.promptTokens ?? 0,
    completionTokens: totals?.completionTokens ?? 0,
    perModel: perModel satisfies ModelShareRow[],
    perEntry: perEntry satisfies EntrySpendRow[],
  }
}

/**
 * The "where am I right now" figures. One pass over the ledger with three
 * filtered sums, because they differ only in their lower bound and a scan of a
 * few thousand rows is cheaper than three of them.
 *
 * Spans deleted stories on purpose: story_id is SET NULL, not cascade, so
 * deleting a manuscript does not un-spend what it cost.
 */
export async function getGlobalCostSummary(
  timeZone: string
): Promise<GlobalCostSummary> {
  const db = await getDb()
  const today = zonedDayStart(0, timeZone)
  // Seven days INCLUDING today, which is what "this week" means to someone
  // looking at a spend figure.
  const weekStart = zonedDayStart(6, timeZone)

  const row = await db
    .select({
      todayUsd: sql<string>`coalesce(sum(${generationCalls.costUsd}) filter (where ${generationCalls.createdAt} >= ${today}), 0)::text`,
      weekUsd: sql<string>`coalesce(sum(${generationCalls.costUsd}) filter (where ${generationCalls.createdAt} >= ${weekStart}), 0)::text`,
      allTimeUsd: totalUsd,
      unpricedCalls: unpricedCount,
      // Counted per window for the same reason the sums are: a "+" on today's
      // figure has to mean "today contains something unpriced", not "the ledger
      // does somewhere".
      todayUnpricedCalls: sql<number>`count(*) filter (where ${generationCalls.costUsd} is null and ${generationCalls.createdAt} >= ${today})::int`,
      weekUnpricedCalls: sql<number>`count(*) filter (where ${generationCalls.costUsd} is null and ${generationCalls.createdAt} >= ${weekStart})::int`,
    })
    .from(generationCalls)
    .where(settled)
    .then((rows) => rows[0])

  return {
    todayUsd: row?.todayUsd ?? "0",
    weekUsd: row?.weekUsd ?? "0",
    allTimeUsd: row?.allTimeUsd ?? "0",
    unpricedCalls: row?.unpricedCalls ?? 0,
    todayUnpricedCalls: row?.todayUnpricedCalls ?? 0,
    weekUnpricedCalls: row?.weekUnpricedCalls ?? 0,
  }
}

/**
 * Spend per local day over the last `days` days, oldest first, empty days
 * absent. "Local" is `timeZone`, the same clock the caller's window bounds and
 * captions come from.
 *
 * Zero-filling is the caller's job: a `generate_series` join is more machinery
 * than a sparkline is worth, and a chart that wants gaps drawn as gaps would
 * have to undo it.
 *
 * `timeZone` has no default: a defaulted "UTC" is the bug this replaced.
 */
export async function getSpendByDay(
  timeZone: string,
  days = 30
): Promise<SpendDay[]> {
  const db = await getDb()
  const since = zonedDayStart(Math.max(0, days - 1), timeZone)
  // GROUP BY 1, never the expression again: the zone is a bound parameter, so
  // repeating it emits $1 in the SELECT and $2 in the GROUP BY, which Postgres
  // rejects as different expressions. The ordinal needs `day` to stay first.
  return db
    .select({ day: dayKey(timeZone), costUsd: totalUsd, calls: callCount })
    .from(generationCalls)
    .where(and(settled, sql`${generationCalls.createdAt} >= ${since}`))
    .groupBy(sql`1`)
    .orderBy(sql`1 asc`)
}

/**
 * All-time spend per story, biggest first.
 *
 * Grouped on orig_story_id, the FK-free copy of the id stamped at mint and
 * never nulled. story_id would collapse every deleted story into one NULL
 * group, and the title snapshot can't split them back apart without also
 * splitting a live story that was ever renamed. The original id is stable
 * through rename and deletion alike: one line per story that ever existed.
 *
 * The title is coalesced through three sources so a deleted story keeps an
 * honest line rather than vanishing — the money left the account whatever
 * became of the manuscript.
 */
export async function getSpendByStory(): Promise<StorySpendRow[]> {
  const db = await getDb()

  return db
    .select({
      // stories.id, not generationCalls.storyId: within an orig group the FK is
      // uniformly the same id or uniformly NULL (SET NULL hits every row in one
      // statement), and the joined column is already in the GROUP BY.
      storyId: stories.id,
      title: sql<string>`coalesce(${stories.title}, max(${generationCalls.storyTitle}), 'Deleted story')`,
      isDeleted: sql<boolean>`(${stories.id} is null)`,
      costUsd: totalUsd,
      calls: callCount,
    })
    .from(generationCalls)
    .leftJoin(stories, eq(stories.id, generationCalls.storyId))
    .where(settled)
    .groupBy(generationCalls.origStoryId, stories.id, stories.title)
    .orderBy(sql`sum(${generationCalls.costUsd}) desc nulls last`)
}

/**
 * All-time spend per model, biggest first. No index on model_id and none
 * wanted: this groups a few thousand rows in memory, which is free, and an
 * index would be write cost on every generation for it.
 */
export async function getSpendByModel(): Promise<ModelSpendRow[]> {
  const db = await getDb()

  return db
    .select({
      modelId: generationCalls.modelId,
      costUsd: totalUsd,
      calls: callCount,
      promptTokens: sql<number>`coalesce(sum(${generationCalls.promptTokens}), 0)::int`,
      completionTokens: sql<number>`coalesce(sum(${generationCalls.completionTokens}), 0)::int`,
    })
    .from(generationCalls)
    .where(settled)
    .groupBy(generationCalls.modelId)
    .orderBy(sql`sum(${generationCalls.costUsd}) desc nulls last`)
}

/**
 * Spend since an ISO instant, optionally scoped to one story — the "session so
 * far" readout.
 *
 * There is no session concept in the schema and it does not need one: a session
 * is a client-side fact (an ISO string pinned in sessionStorage at boot), and
 * every question it answers is answered by a timestamp bound. The
 * (story_id, created_at) index serves the scoped form directly.
 */
export async function getSpendSince(
  sinceIso: string,
  storyId?: string
): Promise<{ costUsd: string; calls: number; unpricedCalls: number }> {
  const db = await getDb()

  const row = await db
    .select({
      costUsd: totalUsd,
      calls: callCount,
      unpricedCalls: unpricedCount,
    })
    .from(generationCalls)
    .where(
      and(
        settled,
        sql`${generationCalls.createdAt} >= ${sinceIso}`,
        storyId ? eq(generationCalls.storyId, storyId) : undefined
      )
    )
    .then((rows) => rows[0])

  return {
    costUsd: row?.costUsd ?? "0",
    calls: row?.calls ?? 0,
    unpricedCalls: row?.unpricedCalls ?? 0,
  }
}
