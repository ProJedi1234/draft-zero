// lib/db/entry-writes.ts — The persist core for story entries.
//
// Extracted from lib/actions/entries.ts so the generation run loop can persist
// a passage without a request scope: server actions call revalidatePath, which
// throws outside a request, and the run loop is a detached task by design (a
// closed tab must not lose prose). The cores here therefore do everything that
// belongs to the WRITE — position, provenance, the journal op, the story touch
// — and deliberately nothing that belongs to a CACHE. Each caller owns its own
// refresh: the actions revalidate the device that acted, the run loop touches
// the sync bus so every device refreshes itself.
import "server-only"

import { and, asc, eq, isNull, sql } from "drizzle-orm"

import type { DrizzleDb, DrizzleTx } from "@/lib/db/client"
import { getDb } from "@/lib/db/client"
import { recordOp } from "@/lib/db/journal"
import { storyVersionBump } from "@/lib/db/story-version"
import { slotProfilesMixed, toStoryEntry } from "@/lib/db/mappers"
import type { StoryEntryRow } from "@/lib/db/schema"
import {
  generationCalls,
  stories,
  storyEntries,
  storyImages,
} from "@/lib/db/schema"
import type {
  ActionKind,
  ActionResult,
  EntryGeneration,
  EntrySource,
  StoryEntry,
} from "@/lib/types"

/**
 * Every mutator below writes its row and records its op in ONE transaction — a
 * history that disagrees with the rows is worse than no history — so the
 * helpers take the handle rather than reaching for getDb() themselves.
 */
export type Handle = DrizzleDb | DrizzleTx

export async function storyExists(
  db: Handle,
  storyId: string
): Promise<boolean> {
  const row = await db
    .select({ id: stories.id })
    .from(stories)
    .where(eq(stories.id, storyId))
    .limit(1)
    .then((rows) => rows[0])
  return Boolean(row)
}

/**
 * Bumps the story's updatedAt so the sidebar's recency ordering follows the
 * write. Named to stay clear of the sync bus's touchStory — that one tells the
 * OTHER devices, this one tells the sort.
 */
export async function touchStoryRow(db: Handle, storyId: string, now: string) {
  await db
    .update(stories)
    // Monotone so the store's LWW never sees updated_at walk backwards.
    .set({ updatedAt: storyVersionBump(now) })
    .where(eq(stories.id, storyId))
}

/**
 * The next free position in the manuscript, counting EVERY row — soft-deleted
 * rows and inactive takes included. They keep their `position`, so reusing a
 * number would put two live passages in one slot the moment one came back.
 *
 * Spans story_entries AND story_images, because a picture is a beat in the
 * story rather than an ornament on one: the two tables share a single ordering
 * sequence so the canvas can merge them by position alone, with no tie to
 * break and no second sort key that could disagree with the first.
 */
export async function nextStoryPosition(
  db: Handle,
  storyId: string
): Promise<number> {
  const [entryRow, imageRow] = await Promise.all([
    db
      .select({ max: sql<number | null>`MAX(${storyEntries.position})` })
      .from(storyEntries)
      .where(eq(storyEntries.storyId, storyId))
      .then((rows) => rows[0]),
    db
      .select({ max: sql<number | null>`MAX(${storyImages.position})` })
      .from(storyImages)
      .where(eq(storyImages.storyId, storyId))
      .then((rows) => rows[0]),
  ])
  const max = Math.max(entryRow?.max ?? -1, imageRow?.max ?? -1)
  return max + 1
}

/**
 * Links the spend-ledger row this passage came from to the passage itself.
 * Runs inside the caller's transaction, so a take and its price are joined in
 * the same commit that creates the take.
 *
 * The `IS NULL` guard means a call can only be claimed once — a stale or
 * duplicated callId sets one nullable foreign key and touches no money column.
 *
 * Deliberately not part of the undo journal. Undo un-renders the prose; it does
 * not un-spend what OpenRouter charged, and the ledger goes on saying so.
 */
async function stampCallEntry(
  tx: Handle,
  callId: string | null | undefined,
  entryId: string,
  variantGroupId: string
) {
  if (!callId) return
  await tx
    .update(generationCalls)
    // origVariantGroupId is the FK-free copy: story_entry_id nulls when the
    // entry is hard-deleted, this one stays, so a slot's takes still sum.
    .set({ storyEntryId: entryId, origVariantGroupId: variantGroupId })
    .where(
      and(eq(generationCalls.id, callId), isNull(generationCalls.storyEntryId))
    )
}

/**
 * The variant ordinal a retry of this slot composes its context with: MAX
 * (variant_index) + 1 over every take, inactive and deleted included — the
 * same rule appendRetryTakeCore numbers the persisted take by.
 *
 * Read server-side because the ordinal feeds the deterministic seed, and a
 * per-tab counter cannot see the takes other devices have already made — two
 * devices' first retries would both restart at 1 and reproduce a take
 * verbatim. A slot with no takes yet answers 1; the slot is checked again at
 * persist time, so a vanished one only costs a seed, never a misfiled row.
 */
export async function nextTakeVariant(
  storyId: string,
  variantGroupId: string
): Promise<number> {
  const db = await getDb()
  const row = await db
    .select({ max: sql<number | null>`MAX(${storyEntries.variantIndex})` })
    .from(storyEntries)
    .where(
      and(
        eq(storyEntries.storyId, storyId),
        eq(storyEntries.variantGroupId, variantGroupId)
      )
    )
    .then((rows) => rows[0])
  const max = row?.max
  return max === null || max === undefined ? 1 : max + 1
}

/**
 * The one write path for an *appended* passage: position, provenance, the turn
 * op and the story touch all live here so a caller can never append a row that
 * the sidebar's updatedAt ordering or the undo journal misses. (The importer
 * and the seed script build rows of their own; neither is a writer's move, so
 * neither records history.)
 *
 * `action` carries the player-turn columns and is null for everything else. The
 * pair travels together because actionKind and inputText are only ever both set
 * or both null — see the StoryEntry doc comment.
 *
 * `turnId` makes a Send and its passage a single ⌘Z: both halves append under
 * the same id and recordOp folds the second into the op the first one wrote.
 */
export async function appendEntryCore(
  storyId: string,
  text: string,
  source: EntrySource,
  opts: {
    action?: { kind: ActionKind; inputText: string } | null
    turnId?: string | null
    generation?: EntryGeneration | null
    /** The spend-ledger row this passage came out of; see stampCallEntry. */
    callId?: string | null
  } = {}
): Promise<ActionResult<{ entry: StoryEntry }>> {
  const trimmed = text.trim()
  if (trimmed === "")
    return { ok: false, error: "Nothing to add — write something first." }

  const db = await getDb()
  if (!(await storyExists(db, storyId)))
    return { ok: false, error: "Story not found." }

  const now = new Date().toISOString()
  const id = crypto.randomUUID()
  const generation = opts.generation ?? null

  const row: StoryEntryRow = {
    id,
    storyId,
    position: await nextStoryPosition(db, storyId),
    source,
    text: trimmed,
    actionKind: opts.action?.kind ?? null,
    inputText: opts.action?.inputText ?? null,
    // A fresh append starts its own slot and is the only take in it; retries
    // join an existing slot through appendRetryTakeCore.
    variantGroupId: id,
    variantIndex: 0,
    isActive: true,
    deletedAt: null,
    genModelId: generation?.modelId ?? null,
    genThinking: generation?.thinking ?? null,
    genTemperature: generation?.temperature ?? null,
    genProfileName: generation?.profileName ?? null,
    promptTokens: generation?.promptTokens ?? null,
    completionTokens: generation?.completionTokens ?? null,
    createdAt: now,
  }

  await db.transaction(async (tx) => {
    await tx.insert(storyEntries).values(row)
    await stampCallEntry(tx, opts.callId, id, row.variantGroupId)
    // Which half this row is follows from its source. The other stays null
    // until written — a generation that dies mid-stream leaves a turn with only
    // its user half, which still has to undo cleanly.
    await recordOp(
      tx,
      storyId,
      {
        kind: "turn",
        userEntryId: source === "user" ? id : null,
        generatedEntryId: source === "generated" ? id : null,
      },
      opts.turnId ?? null
    )
    await touchStoryRow(tx, storyId, now)
  })

  return {
    ok: true,
    data: {
      // A slot of one cannot disagree with itself about what wrote it.
      entry: toStoryEntry(row, { index: 0, count: 1, profilesMixed: false }),
    },
  }
}

/**
 * A retry: a new take beside the one that was showing, same slot, same position.
 *
 * The outgoing take must be deactivated BEFORE the new one is inserted. All
 * takes share a position and the partial unique index covers live+active rows,
 * so inserting first leaves two active rows there and Postgres rejects it.
 *
 * `variant_index` is MAX + 1 over every take including inactive and deleted
 * ones: it records the order takes were made in, and reusing a departed take's
 * number would make the switcher's order depend on what happens to be visible.
 */
async function appendRetryTakeCore(
  storyId: string,
  text: string,
  variantGroupId: string,
  generation: EntryGeneration | null,
  callId: string | null
): Promise<ActionResult<{ entry: StoryEntry }>> {
  const trimmed = text.trim()
  if (trimmed === "")
    return { ok: false, error: "Nothing to add — write something first." }

  const db = await getDb()
  const now = new Date().toISOString()
  const id = crypto.randomUUID()

  return db.transaction(
    async (tx): Promise<ActionResult<{ entry: StoryEntry }>> => {
      // One query for the whole slot: the take to step aside, the highest
      // index so far, and the live count. A slot holds a handful of rows.
      const takes = await tx
        .select({
          id: storyEntries.id,
          position: storyEntries.position,
          variantIndex: storyEntries.variantIndex,
          isActive: storyEntries.isActive,
          deletedAt: storyEntries.deletedAt,
          // Only so the returned entry can say whether this slot's takes now
          // disagree about which profile wrote them; see slotProfilesMixed.
          genProfileName: storyEntries.genProfileName,
        })
        .from(storyEntries)
        .where(
          and(
            eq(storyEntries.storyId, storyId),
            eq(storyEntries.variantGroupId, variantGroupId)
          )
        )
        .orderBy(asc(storyEntries.variantIndex))

      const previous = takes.find(
        (take) => take.isActive && take.deletedAt === null
      )
      // The slot vanished between pressing Retry and the stream finishing.
      // With no position to insert at, refusing beats dropping the passage
      // somewhere plausible.
      if (!previous)
        return { ok: false, error: "That passage is no longer in the story." }

      const maxIndex = takes.reduce(
        (highest, take) => Math.max(highest, take.variantIndex),
        0
      )
      const liveTakes = takes.filter((take) => take.deletedAt === null)
      const liveCount = liveTakes.length

      const row: StoryEntryRow = {
        id,
        storyId,
        position: previous.position,
        source: "generated",
        text: trimmed,
        actionKind: null,
        inputText: null,
        variantGroupId,
        variantIndex: maxIndex + 1,
        isActive: true,
        deletedAt: null,
        genModelId: generation?.modelId ?? null,
        genThinking: generation?.thinking ?? null,
        genTemperature: generation?.temperature ?? null,
        genProfileName: generation?.profileName ?? null,
        promptTokens: generation?.promptTokens ?? null,
        completionTokens: generation?.completionTokens ?? null,
        createdAt: now,
      }

      await tx
        .update(storyEntries)
        .set({ isActive: false })
        .where(eq(storyEntries.id, previous.id))
      await tx.insert(storyEntries).values(row)
      // Every take is its own call and its own row, so a slot's takes each
      // carry their own price and the slot's total is their sum.
      await stampCallEntry(tx, callId, id, variantGroupId)
      await recordOp(tx, storyId, {
        kind: "retry",
        variantGroupId,
        previousEntryId: previous.id,
        newEntryId: id,
      })
      await touchStoryRow(tx, storyId, now)

      return {
        ok: true,
        data: {
          // Newest take, so last among the live ones, in a slot one larger.
          entry: toStoryEntry(row, {
            index: liveCount,
            count: liveCount + 1,
            profilesMixed: slotProfilesMixed([...liveTakes, row]),
          }),
        },
      }
    }
  )
}

/**
 * Persists a generated passage — the run loop's settle path.
 *
 * `variantGroupId` tells the two shapes apart: without one this is the ordinary
 * end of a turn, a new passage at the end of the manuscript; with one it is a
 * Retry, another take of an existing slot at that slot's same position.
 *
 * Retry never deletes or truncates — only the last block can be regenerated
 * (see the headstone at the bottom of lib/actions/entries.ts), so it can only
 * add a take to a slot nothing follows.
 */
export async function persistGeneratedEntry(
  storyId: string,
  text: string,
  opts: {
    turnId?: string | null
    variantGroupId?: string
    generation?: EntryGeneration | null
    /**
     * The spend-ledger row opened for the call that wrote this text. Null on
     * the offline mock and on any call the recorder failed to open — both
     * leave the row unlinked, which is exactly what an aborted call looks
     * like and is never a reason to refuse the passage.
     */
    callId?: string | null
  } = {}
): Promise<ActionResult<{ entry: StoryEntry }>> {
  if (opts.variantGroupId === undefined) {
    return appendEntryCore(storyId, text, "generated", {
      turnId: opts.turnId,
      generation: opts.generation,
      callId: opts.callId,
    })
  }
  return appendRetryTakeCore(
    storyId,
    text,
    opts.variantGroupId,
    opts.generation ?? null,
    opts.callId ?? null
  )
}
