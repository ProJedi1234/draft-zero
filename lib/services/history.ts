// lib/services/history.ts — Walking a story's history, callable from a server
// action, a route handler or an MCP tool alike.
import "server-only"

import { and, asc, desc, eq, isNull } from "drizzle-orm"

import type { DrizzleTx } from "@/lib/db/client"
import { getDb } from "@/lib/db/client"
import { applyMutations, recordOp } from "@/lib/db/journal"
import { stories, storyEntries, storyOps } from "@/lib/db/schema"
import { storyVersionBump } from "@/lib/db/story-version"
import { refuseDuringRun } from "@/lib/generation/live"
import type { OpPayload } from "@/lib/history/ops"
import { parsePayload, redoPlan, summarize, undoPlan } from "@/lib/history/ops"
import { commitChange } from "@/lib/services/commit"
import type { Service } from "@/lib/services/context"
import {
  redoStoryOpInput,
  selectVariantInput,
  undoStoryOpInput,
  type RedoStoryOpInput,
  type SelectVariantInput,
  type UndoStoryOpInput,
} from "@/lib/services/history.schema"
import { fail, ok, parseInput, type ServiceResult } from "@/lib/services/result"

type MoveData = { summary: string } | null
type HistoryMove = ServiceResult<MoveData>

// The three moves that walk a story through its history. Same shape each time:
// transaction, apply the plan from lib/history/ops.ts, move the cursor, touch
// the story, commit. Nothing is destroyed — undo only flips flags back.
//
// Each returns `{ summary }` so the client can say what it did, and `null` —
// still ok — when there was nothing to do. ⌘Z at the start of a story should do
// nothing quietly rather than raise a toast.
//
// All three refuse while a generation is running. The client darkens these
// controls on a device that is mirroring the run, but a device that ISN'T —
// woke up mid-run, missed the run-started — has them lit, and an undo landing
// mid-run deactivates the very slot the run persists into (the passage is
// silently dropped) or truncates the redo tail out from under the run's own
// recordOp. The run's settle is the moment history becomes safe to walk again.

/**
 * The story's cursor, or null when the story is gone — callers turn that into
 * an error, since unlike recordOp they have nothing else to accomplish.
 *
 * FOR UPDATE: the cursor is read here and written a few statements later, so
 * without the lock a generation finishing in another tab can append an op in
 * between and this transaction moves the cursor as if it never happened.
 */
async function readCursor(
  tx: DrizzleTx,
  storyId: string
): Promise<number | null> {
  const row = await tx
    .select({ undoCursor: stories.undoCursor })
    .from(stories)
    .where(eq(stories.id, storyId))
    .limit(1)
    .for("update")
    .then((rows) => rows[0])
  return row ? row.undoCursor : null
}

/** The op at one seq, parsed. Null when there is none or it cannot be trusted. */
async function readOp(
  tx: DrizzleTx,
  storyId: string,
  seq: number
): Promise<{ summary: string; payload: OpPayload } | null> {
  const row = await tx
    .select()
    .from(storyOps)
    .where(and(eq(storyOps.storyId, storyId), eq(storyOps.seq, seq)))
    .limit(1)
    .then((rows) => rows[0])
  if (!row) return null
  const payload = parsePayload(row.payloadJson)
  if (!payload) return null
  return { summary: row.summary, payload }
}

/**
 * Reverses the op at the cursor and steps back. The op stays on disk as the
 * head of the redo tail — which is why the cursor is a position rather than a
 * "delete the last op" rule.
 */
export const undoStoryOp: Service<UndoStoryOpInput, MoveData> = async (raw) => {
  const parsed = parseInput(undoStoryOpInput, raw)
  if (!parsed.ok) return parsed
  const { storyId } = parsed.data
  const running = refuseDuringRun(storyId)
  if (running) return fail("conflict", running.error)
  const db = await getDb()
  const now = new Date().toISOString()

  const result = await db.transaction(async (tx): Promise<HistoryMove> => {
    const cursor = await readCursor(tx, storyId)
    if (cursor === null) return fail("not_found", "Story not found.")

    // Cursor 0 is the start of the history; there is no op at seq 0.
    if (cursor === 0) return ok(null)

    const op = await readOp(tx, storyId, cursor)
    // Missing or unparseable: an opaque wall, not an error. The button is
    // already dark — readHistoryState gates on the same parse.
    if (!op) return ok(null)

    await applyMutations(tx, undoPlan(op.payload))
    await tx
      .update(stories)
      .set({ undoCursor: cursor - 1, updatedAt: storyVersionBump(now) })
      .where(eq(stories.id, storyId))

    return ok({ summary: op.summary })
  })

  if (result.ok) commitChange(storyId)
  return result
}

/** Reapplies the op above the cursor and steps forward. */
export const redoStoryOp: Service<RedoStoryOpInput, MoveData> = async (raw) => {
  const parsed = parseInput(redoStoryOpInput, raw)
  if (!parsed.ok) return parsed
  const { storyId } = parsed.data
  const running = refuseDuringRun(storyId)
  if (running) return fail("conflict", running.error)
  const db = await getDb()
  const now = new Date().toISOString()

  const result = await db.transaction(async (tx): Promise<HistoryMove> => {
    const cursor = await readCursor(tx, storyId)
    if (cursor === null) return fail("not_found", "Story not found.")

    // Nothing above the cursor: either nothing was undone, or the writer did
    // something new afterwards and recordOp truncated the tail.
    const op = await readOp(tx, storyId, cursor + 1)
    if (!op) return ok(null)

    await applyMutations(tx, redoPlan(op.payload))
    await tx
      .update(stories)
      .set({ undoCursor: cursor + 1, updatedAt: storyVersionBump(now) })
      .where(eq(stories.id, storyId))

    return ok({ summary: op.summary })
  })

  if (result.ok) commitChange(storyId)
  return result
}

/**
 * Switches which take is active, by offset (-1 previous, +1 next). A no-op at
 * either end returns ok with null.
 *
 * An offset rather than an id, so the client never holds the sibling ids —
 * shipping the whole slot to the page just to name the target would put the
 * manuscript's inactive prose in the HTML for no other reason.
 *
 * The switch is itself recorded, so a writer who clicks past the take they
 * wanted can undo back instead of working out which way they came.
 */
export const selectVariantByOffset: Service<
  SelectVariantInput,
  MoveData
> = async (raw) => {
  const parsed = parseInput(selectVariantInput, raw)
  if (!parsed.ok) return parsed
  const { storyId, entryId, offset } = parsed.data
  const running = refuseDuringRun(storyId)
  if (running) return fail("conflict", running.error)
  const db = await getDb()
  const now = new Date().toISOString()

  const result = await db.transaction(async (tx): Promise<HistoryMove> => {
    const anchor = await tx
      .select({
        variantGroupId: storyEntries.variantGroupId,
        position: storyEntries.position,
      })
      .from(storyEntries)
      .where(
        and(
          eq(storyEntries.id, entryId),
          eq(storyEntries.storyId, storyId),
          isNull(storyEntries.deletedAt)
        )
      )
      .limit(1)
      .then((rows) => rows[0])

    if (!anchor) return fail("not_found", "Passage not found.")

    // Only the last block may switch takes. The client renders the switcher
    // there alone, but the client is the one thing a user can forge, and this
    // write would otherwise rewrite a passage the rest of the story was built
    // on. Earlier blocks are settled prose, not a live choice.
    const lastPosition = await tx
      .select({ position: storyEntries.position })
      .from(storyEntries)
      .where(
        and(
          eq(storyEntries.storyId, storyId),
          eq(storyEntries.isActive, true),
          isNull(storyEntries.deletedAt)
        )
      )
      .orderBy(desc(storyEntries.position))
      .limit(1)
      .then((rows) => rows[0])

    if (!lastPosition || lastPosition.position !== anchor.position) {
      return fail(
        "conflict",
        "Only the newest passage can switch between takes."
      )
    }

    // The live takes, in the order the switcher shows them. Deleted ones are
    // excluded — they are not part of the "2 / 3" the writer is reading.
    const takes = await tx
      .select({ id: storyEntries.id, isActive: storyEntries.isActive })
      .from(storyEntries)
      .where(
        and(
          eq(storyEntries.storyId, storyId),
          eq(storyEntries.variantGroupId, anchor.variantGroupId),
          isNull(storyEntries.deletedAt)
        )
      )
      .orderBy(asc(storyEntries.variantIndex))

    // Measured from whichever take is actually active, not the id the client
    // sent: a stale render would otherwise step from a take that has already
    // stopped showing and jump two places.
    const fromIndex = takes.findIndex((take) => take.isActive)
    if (fromIndex === -1) return fail("not_found", "Passage not found.")

    const toIndex = fromIndex + offset
    // Off either end: nothing to do, and the arrow was already disabled.
    if (toIndex === fromIndex || toIndex < 0 || toIndex >= takes.length) {
      return ok(null)
    }

    const payload: OpPayload = {
      kind: "switch-take",
      variantGroupId: anchor.variantGroupId,
      fromEntryId: takes[fromIndex].id,
      toEntryId: takes[toIndex].id,
    }

    // redoPlan is the forward direction of an op, which is what doing it for
    // the first time is — and it deactivates before activating, as the
    // partial unique index requires.
    await applyMutations(tx, redoPlan(payload))
    await recordOp(tx, storyId, payload)
    await tx
      .update(stories)
      .set({ updatedAt: storyVersionBump(now) })
      .where(eq(stories.id, storyId))

    return ok({ summary: summarize(payload) })
  })

  if (result.ok) commitChange(storyId)
  return result
}
