// lib/db/journal.ts — The undo journal's read and write helpers.
//
// Server-only, and deliberately NOT a "use server" file: every export of one of
// those becomes a callable endpoint, and these are internal primitives.
//
// Each function takes the `tx`/`db` handle rather than calling getDb(), because
// a write and the op describing it have to commit together — an op against a
// row that never landed is a history that lies.
//
// The op → mutations translation lives in lib/history/ops.ts, pure and tested.
// This module only executes what that one plans.

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
 * Appends an op, truncating the redo tail first, and advances the cursor. When
 * `turnId` matches the op at the cursor it EXTENDS that op instead — which is
 * what makes a Send and its generation one undo step.
 *
 * Nothing here may throw on a reachable state. It runs inside the caller's
 * transaction, so a constraint violation rolls back the row write it was
 * describing — for a generation, prose the writer waited thirty seconds for.
 * Every uniqueness question below is settled by a read, not by a hopeful insert.
 */
export async function recordOp(
  tx: DrizzleTx,
  storyId: string,
  payload: OpPayload,
  turnId?: string | null
): Promise<void> {
  // The cursor is the seq of the newest applied op. FOR UPDATE serialises this
  // story's journal writers: without it two concurrent writers derive the same
  // seq and the loser hits the unique index, taking its caller's write down.
  const cursor = await readCursor(tx, storyId, true)
  if (cursor === null) return

  // Doing something new after an undo discards the redo tail, as in any editor.
  // Up front, so the merge paths below truncate too — merging is as much a new
  // action as appending, and leaving the tail would let Redo reapply a step the
  // writer had undone and then written past.
  await tx
    .delete(storyOps)
    .where(and(eq(storyOps.storyId, storyId), gt(storyOps.seq, cursor)))

  // Turn extension: the second half of a Send finds the op the first half wrote
  // and fills in the id that was still null.
  //
  // Looked up by `turnId` rather than by seq, because both answers matter — an
  // op at the cursor is the one to extend, and an op anywhere else is a live
  // claim on this (story_id, turn_id) that the insert below must not collide
  // with. Saving a passage edit mid-stream is enough to cause the latter.
  // Extension stays pinned to the cursor: a turn op buried under a later op has
  // been stepped away from, and reviving it would resurrect that step.
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
      // The cursor stays put: this is still one undo step.
      return
    }
  }

  // Edit coalescing. Not about debounce — the passage editor saves explicitly —
  // but about reopening the same block twice to get a sentence right, and about
  // the "Edit prose instead" hatch, where one repair is two saves. Merging keeps
  // the earliest `before`, so undo returns to the state before the fiddling.
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

  const seq = cursor + 1
  await tx.insert(storyOps).values({
    id: crypto.randomUUID(),
    storyId,
    seq,
    kind: payload.kind,
    // Only turns carry one, and only when no surviving op already claims it.
    // When one does, this half becomes its own undo step under a NULL turn id:
    // two ⌘Z for one Send is worse UX, a unique violation is a lost passage.
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
 * Applies mutations in order. Sequential, never Promise.all: a plan that moves
 * `is_active` between takes deactivates before activating, and the partial
 * unique index rejects the pair if they overlap.
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
          // A timestamp rather than a flag, so the row records when it left.
          // Restoring is a plain UPDATE back to NULL — `position` was kept.
          .set({
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
        // All three together: actionKind and inputText are always both set or
        // both null, so moving one without the others produces a row no other
        // path can.
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
 * Undo/redo availability and labels. Both ends are gated on the payload
 * parsing: a corrupt op darkens the button rather than offering a step that
 * would throw when taken.
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

  // One query for both ends: the op at the cursor is what undo reverses, the
  // one above it what redo reapplies, and its absence is an empty redo tail.
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

  // cursor === 0 means nothing applied, so there is no op at seq 0 to find.
  const undoRow = rows.find((row) => row.seq === cursor)
  const redoRow = rows.find((row) => row.seq === cursor + 1)

  const undoable = undoRow && parsePayload(undoRow.payloadJson) !== null
  const redoable = redoRow && parsePayload(redoRow.payloadJson) !== null

  return {
    canUndo: Boolean(undoable),
    canRedo: Boolean(redoable),
    // The stored summary, not a re-summarize: it is the phrase written at the
    // time, which is what the tooltip is for.
    undoSummary: undoable ? undoRow.summary : null,
    redoSummary: redoable ? redoRow.summary : null,
  }
}

/**
 * The story's undo cursor, or null when the story is gone — recordOp runs
 * inside somebody else's transaction, and a vanished story is not worth
 * aborting their write over.
 *
 * `lock` takes FOR UPDATE, and writers pass it: every op's seq is derived from
 * this read, so an unlocked read-then-write lets two transactions derive the
 * same seq. The read path does not lock; it has no business blocking a writer.
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

/** The op holding one `turnId` — at most one, per the unique index. */
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
 * Folds the second half of a turn into the first. Null when they are not both
 * turns, so the caller appends a fresh op rather than overwriting unrelated
 * history. The existing id wins over a null: the writer's action is recorded
 * first and must not be erased by the generated half arriving without it.
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
