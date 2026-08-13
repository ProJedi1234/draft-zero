// lib/db/journal.ts — The undo journal's read and write helpers.
//
// Server-only, and deliberately NOT a "use server" file. Every export of a
// "use server" module becomes a callable HTTP endpoint, and none of these are
// things a browser should be able to invoke: they are the primitives that the
// server actions in lib/actions/* compose into one transaction alongside the
// row write they record. Same shape as lib/db/queries.ts.
//
// Every function takes the `tx`/`db` handle rather than calling `getDb()`
// itself, because a write and the op that describes it have to commit together
// or not at all. An op recorded against a row that never landed (or a row that
// landed with no op) is a history that lies, and undo would then either do
// nothing or reverse the wrong thing.
//
// The translation from an op to the row mutations that reverse or reapply it
// lives in lib/history/ops.ts, pure and testable. This module only executes
// what that module plans.

import { and, asc, eq, gt, inArray } from "drizzle-orm"

import {
  coalesceEdit,
  parsePayload,
  summarize,
  type EntryMutation,
  type OpPayload,
} from "@/lib/history/ops"
import type { HistoryState } from "@/lib/types"

import type { DrizzleDb, DrizzleTx } from "./client"
import { storyEntries, storyOps, stories } from "./schema"

/**
 * Appends an op, truncating the redo tail first, and advances the cursor.
 *
 * When `turnId` matches a live op at the cursor, EXTENDS that op instead of
 * adding one — this is what makes a Send and its generation a single undo step.
 *
 * The steps below are in priority order, and the two merge steps exist purely
 * so that ⌘Z matches what the writer thinks of as one move rather than what the
 * database thinks of as one write.
 *
 * Nothing in here is allowed to throw on a state the app can actually reach.
 * It runs inside the caller's transaction, so a constraint violation raised
 * here does not merely lose an op — it rolls back the row write it was
 * describing, and for a generation that row holds prose the writer waited
 * thirty seconds for and can never get back. Every uniqueness question below is
 * therefore settled by a read, not by hoping the insert lands.
 */
export async function recordOp(
  tx: DrizzleTx,
  storyId: string,
  payload: OpPayload,
  turnId?: string | null
): Promise<void> {
  // Step 1 — where the story currently sits in its own history. Everything
  // below is relative to this: the cursor is the seq of the newest APPLIED op,
  // so `cursor` is the row undo would reverse and anything above it is a redo
  // tail that this new op is about to invalidate.
  //
  // The story row is locked FOR UPDATE, which serialises every writer of this
  // story's journal for the rest of the transaction. Without it two concurrent
  // writers — a second tab, or a generation finishing while an edit saves —
  // both read the same cursor, both compute `seq = cursor + 1`, and the loser
  // hits story_ops_story_id_seq_idx and takes its caller's row write down with
  // it. Contention is a non-issue: the lock is per story, and one story has one
  // writer nearly all of the time.
  const cursor = await readCursor(tx, storyId, true)
  if (cursor === null) return

  // Step 2 — truncate the redo tail, up front and on every path below. Doing
  // something new after an undo discards it, exactly as every text editor does:
  // the ops above the cursor describe a future that no longer follows from the
  // rows on disk, and keeping them would let a later redo apply a mutation to a
  // passage that has since been rewritten.
  //
  // Deliberately here rather than beside the INSERT, because merging into an
  // existing op is just as much "doing something new" as appending one. An edit
  // that coalesced into the op at the cursor and left the tail standing would
  // leave Redo lit up, offering to reapply a step the writer had undone and
  // then written past. It also means the INSERT below is the only op at its
  // seq, and the turn lookup that follows can only find ops that are going to
  // survive this call.
  await tx
    .delete(storyOps)
    .where(and(eq(storyOps.storyId, storyId), gt(storyOps.seq, cursor)))

  // Step 3 — turn extension. A Send writes the writer's action immediately and
  // the generated passage only when the stream finishes; two writes, one move.
  // The second one carries the same `turnId`, finds the op the first one wrote
  // and fills in the half that was still null, so a single ⌘Z takes back both
  // the action and the passage it produced.
  //
  // The op is looked up BY `turnId` rather than by seq, even though only the
  // one sitting at the cursor may be extended. Both answers matter: an op at
  // the cursor is the one to merge into, and an op anywhere else is a live
  // claim on this (story_id, turn_id) that step 5 must not collide with.
  // Something as ordinary as saving a passage edit while the model streams
  // moves the cursor past the turn op, and the insert that used to follow threw
  // a unique violation that discarded the finished passage.
  //
  // Extension stays pinned to `seq = cursor`. A turn whose op is no longer at
  // the cursor has already been undone (or buried under a later op), and
  // quietly extending it would resurrect a step the writer had explicitly
  // stepped away from.
  const turnOwner = turnId ? await readOpByTurnId(tx, storyId, turnId) : null
  if (turnOwner && turnOwner.seq === cursor) {
    const merged = mergeTurn(turnOwner.payload, payload)
    if (merged) {
      await tx
        .update(storyOps)
        .set({
          payloadJson: JSON.stringify(merged),
          summary: summarize(merged),
        })
        .where(eq(storyOps.id, turnOwner.id))
      // The cursor does not move: this is still the same single undo step.
      return
    }
  }

  // Step 4 — edit coalescing. The passage editor saves explicitly, so this is
  // not about debounce flushes: it is about the writer who reopens the same
  // block two or three times in a row to get one sentence right, and the
  // "Edit prose instead" hatch, where repairing a Say is a save that demotes
  // the row followed by a save that fixes the words. Each of those is one
  // repair to a writer and several rows to Postgres, and without merging ⌘Z
  // would walk back through the intermediate states nobody meant to keep.
  // Merging keeps the
  // EARLIEST `before`, so undo returns the block to how it read before the
  // fiddling started. `coalesceEdit` refuses anything that is not an
  // immediately-preceding edit of the same entry, which is the boundary a
  // writer would expect to stop at.
  if (payload.kind === "edit") {
    const previous = await readOpAtSeq(tx, storyId, cursor)
    const merged = previous?.payload && coalesceEdit(previous.payload, payload)
    if (previous && merged) {
      await tx
        .update(storyOps)
        .set({ payloadJson: JSON.stringify(merged) })
        .where(eq(storyOps.id, previous.id))
      return
    }
  }

  // Step 5 — an ordinary new op, at the seq the truncation above just freed.
  const seq = cursor + 1
  await tx.insert(storyOps).values({
    id: crypto.randomUUID(),
    storyId,
    seq,
    kind: payload.kind,
    // Only turns carry one; NULLs are distinct in a Postgres unique index, so
    // every other op sits outside the (story_id, turn_id) constraint.
    //
    // And a turn only carries it when no surviving op already claims it. When
    // one does — the writer's half is on disk but something has landed on top
    // of it, so step 3 could not extend it — this half becomes its own undo
    // step under a NULL turn id. Two steps to take back one Send is a slightly
    // worse ⌘Z; a unique violation is a lost passage.
    turnId:
      payload.kind === "turn" && turnOwner === null ? (turnId ?? null) : null,
    summary: summarize(payload),
    payloadJson: JSON.stringify(payload),
    createdAt: new Date().toISOString(),
  })
  await tx
    .update(stories)
    .set({ undoCursor: seq })
    .where(eq(stories.id, storyId))
}

/**
 * Applies mutations in order. Used by undo and redo alike — the two directions
 * differ only in the plan they are handed, which is the point of keeping the
 * planning pure.
 *
 * Sequential on purpose, never `Promise.all`: where a plan moves `is_active`
 * between two takes of one slot it deactivates before activating, and the
 * partial unique index on (story_id, position) rejects the pair if they
 * overlap. Issuing them concurrently would throw that ordering away.
 */
export async function applyMutations(
  tx: DrizzleTx,
  mutations: EntryMutation[]
): Promise<void> {
  for (const mutation of mutations) {
    switch (mutation.type) {
      case "set-deleted":
        await tx
          .update(storyEntries)
          .set({
            // A timestamp rather than a flag, so the row records *when* it left
            // the manuscript. Restoring is a plain UPDATE back to NULL because
            // the soft delete kept `position` untouched.
            deletedAt: mutation.deleted ? new Date().toISOString() : null,
          })
          .where(eq(storyEntries.id, mutation.entryId))
        break
      case "set-active":
        await tx
          .update(storyEntries)
          .set({ isActive: mutation.active })
          .where(eq(storyEntries.id, mutation.entryId))
        break
      case "set-prose":
        // All three columns are written together. `actionKind` and `inputText`
        // are always both set or both null (see the schema), and an edit that
        // turned a Say into a Do has to move both or the row becomes a state
        // that no other code path can produce.
        await tx
          .update(storyEntries)
          .set({
            text: mutation.prose.text,
            actionKind: mutation.prose.actionKind,
            inputText: mutation.prose.inputText,
          })
          .where(eq(storyEntries.id, mutation.entryId))
        break
    }
  }
}

/**
 * {canUndo, canRedo, undoSummary, redoSummary} for a story, from the cursor.
 *
 * Both ends are gated on the op's payload actually parsing. A corrupt or
 * future-version payload is an opaque wall in the history: the button goes
 * dark rather than offering a step that would throw the moment it was taken.
 */
export async function readHistoryState(
  db: DrizzleDb,
  storyId: string
): Promise<HistoryState> {
  const cursor = await readCursor(db, storyId)
  if (cursor === null) {
    return {
      canUndo: false,
      canRedo: false,
      undoSummary: null,
      redoSummary: null,
    }
  }

  // One query for both ends. The op AT the cursor is what undo would reverse;
  // the op immediately above it is what redo would reapply, and its absence is
  // exactly what "the redo tail is empty" means.
  const rows = await db
    .select()
    .from(storyOps)
    .where(
      and(
        eq(storyOps.storyId, storyId),
        inArray(storyOps.seq, [cursor, cursor + 1])
      )
    )
    .orderBy(asc(storyOps.seq))

  const undoRow = rows.find((row) => row.seq === cursor)
  const redoRow = rows.find((row) => row.seq === cursor + 1)

  // `cursor === 0` means nothing has been applied, so there is deliberately no
  // op at seq 0 to find and undo is simply unavailable.
  const undoable = undoRow && parsePayload(undoRow.payloadJson) !== null
  const redoable = redoRow && parsePayload(redoRow.payloadJson) !== null

  return {
    canUndo: Boolean(undoable),
    canRedo: Boolean(redoable),
    // The stored `summary` column, not a re-`summarize` of the payload: it is
    // the phrase that was written at the time and it is what the tooltip is
    // for. Parsing above is still required, because a summary the journal
    // cannot act on is worse than no button at all.
    undoSummary: undoable ? undoRow.summary : null,
    redoSummary: redoable ? redoRow.summary : null,
  }
}

/**
 * The story's undo cursor, or null when the story is gone.
 *
 * Null rather than a throw: `recordOp` runs inside somebody else's transaction
 * and a story deleted out from under it is not an error worth aborting that
 * caller's write over — there is simply no history to append to.
 *
 * `lock` takes a FOR UPDATE row lock, and writers pass it. The cursor is a
 * read-then-write: every op's seq is derived from it, so two transactions that
 * read it concurrently derive the same seq and one of them loses to the unique
 * index — inside somebody else's transaction, taking their row write with it.
 * The read path (readHistoryState) deliberately does not lock; it is a snapshot
 * for two button states and has no business blocking a writer.
 */
async function readCursor(
  tx: DrizzleTx | DrizzleDb,
  storyId: string,
  lock = false
): Promise<number | null> {
  const query = tx
    .select({ undoCursor: stories.undoCursor })
    .from(stories)
    .where(eq(stories.id, storyId))
    .limit(1)
  const rows = await (lock ? query.for("update") : query)
  const row = rows[0]
  return row ? row.undoCursor : null
}

/** The op at one seq, with its payload already parsed (null when it will not). */
async function readOpAtSeq(
  tx: DrizzleTx,
  storyId: string,
  seq: number
): Promise<{ id: string; payload: OpPayload | null } | null> {
  const row = await tx
    .select()
    .from(storyOps)
    .where(and(eq(storyOps.storyId, storyId), eq(storyOps.seq, seq)))
    .limit(1)
    .then((rows) => rows[0])
  if (!row) return null
  return { id: row.id, payload: parsePayload(row.payloadJson) }
}

/**
 * The op holding one `turnId`, if any. There is at most one — that is what
 * story_ops_story_id_turn_id_idx guarantees — and its `seq` is what decides
 * whether it can be extended or merely has to be avoided.
 */
async function readOpByTurnId(
  tx: DrizzleTx,
  storyId: string,
  turnId: string
): Promise<{ id: string; seq: number; payload: OpPayload | null } | null> {
  const row = await tx
    .select()
    .from(storyOps)
    .where(and(eq(storyOps.storyId, storyId), eq(storyOps.turnId, turnId)))
    .limit(1)
    .then((rows) => rows[0])
  if (!row) return null
  return { id: row.id, seq: row.seq, payload: parsePayload(row.payloadJson) }
}

/**
 * Fold the second half of a turn into the first. Returns null when the two are
 * not both turns — a mismatch means the op the `turnId` found is not one this
 * payload belongs in, and the caller falls through to appending a fresh op
 * (under a NULL turn id, since the existing one still holds this `turnId`)
 * rather than overwriting somebody else's history.
 *
 * Each half only ever fills in what it produced, so the existing id wins over a
 * null: the writer's action is recorded before the stream starts and must not
 * be erased by the generated half arriving with `userEntryId: null`.
 */
function mergeTurn(
  existing: OpPayload | null,
  incoming: OpPayload
): OpPayload | null {
  if (existing?.kind !== "turn" || incoming.kind !== "turn") return null
  return {
    kind: "turn",
    userEntryId: incoming.userEntryId ?? existing.userEntryId,
    generatedEntryId: incoming.generatedEntryId ?? existing.generatedEntryId,
  }
}
