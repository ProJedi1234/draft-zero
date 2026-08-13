"use server"

import { and, asc, desc, eq, isNull } from "drizzle-orm"
import { revalidatePath } from "next/cache"

import type { DrizzleTx } from "@/lib/db/client"
import { getDb } from "@/lib/db/client"
import { applyMutations, recordOp } from "@/lib/db/journal"
import { stories, storyEntries, storyOps } from "@/lib/db/schema"
import type { OpPayload } from "@/lib/history/ops"
import { parsePayload, redoPlan, summarize, undoPlan } from "@/lib/history/ops"
import type { ActionResult } from "@/lib/types"

// The three moves that walk a story through its own history. All of them are
// the same shape: open a transaction, work out which rows have to change, apply
// the plan lib/history/ops.ts produced, move the cursor, touch the story,
// revalidate. None of them destroys anything — undo flips flags back, and even
// a retry that has been undone leaves its take on disk and reachable.
//
// Each returns `{ summary }` on success so the client can say what it just did,
// and `null` — still `ok` — when there was simply nothing to do. A dead end is
// not a failure: ⌘Z at the beginning of a story should do nothing quietly, not
// raise a toast.

/**
 * The undo/redo pair below both need the story's cursor, and both have to fail
 * the same way when the story is gone. Returns null when there is no such
 * story; the callers turn that into an error, because unlike `recordOp` (which
 * runs inside somebody else's write) these actions have nothing else to
 * accomplish.
 *
 * FOR UPDATE, and for the same reason `recordOp` locks: the cursor is read here
 * and written a few statements later, so without the lock a generation
 * finishing in another tab can append an op in between and this transaction
 * will move the cursor as if it never happened — leaving the new op stranded
 * above the cursor as a redo tail nobody asked for. The lock is per story and
 * every writer of a story's history takes it, so they simply queue.
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
 * Reverses the op at the cursor and steps the cursor back.
 *
 * The op is left on disk: it is now the head of the redo tail, which is the
 * whole reason the cursor is a position rather than a "delete the last op"
 * rule. Redo has to be able to reapply this without reconstructing it.
 */
export async function undoStoryOp(
  storyId: string
): Promise<ActionResult<{ summary: string } | null>> {
  const db = await getDb()
  const now = new Date().toISOString()

  const result = await db.transaction(
    async (tx): Promise<ActionResult<{ summary: string } | null>> => {
      const cursor = await readCursor(tx, storyId)
      if (cursor === null) return { ok: false, error: "Story not found." }

      // Cursor 0 means nothing has been applied — the beginning of the story's
      // history, and there is deliberately no op at seq 0 to reach for.
      if (cursor === 0) return { ok: true, data: null }

      const op = await readOp(tx, storyId, cursor)
      // Either the op is missing (a history that has lost its own head) or its
      // payload will not parse. Both are opaque walls rather than errors: undo
      // simply stops here, and the button is already dark because
      // readHistoryState gates on exactly the same parse.
      if (!op) return { ok: true, data: null }

      await applyMutations(tx, undoPlan(op.payload))
      await tx
        .update(stories)
        .set({ undoCursor: cursor - 1, updatedAt: now })
        .where(eq(stories.id, storyId))

      return { ok: true, data: { summary: op.summary } }
    }
  )

  if (result.ok) revalidatePath("/", "layout")
  return result
}

/** Reapplies the op above the cursor and steps forward. */
export async function redoStoryOp(
  storyId: string
): Promise<ActionResult<{ summary: string } | null>> {
  const db = await getDb()
  const now = new Date().toISOString()

  const result = await db.transaction(
    async (tx): Promise<ActionResult<{ summary: string } | null>> => {
      const cursor = await readCursor(tx, storyId)
      if (cursor === null) return { ok: false, error: "Story not found." }

      // No op above the cursor means the redo tail is empty — either nothing
      // has been undone, or the writer did something new after undoing and
      // `recordOp` truncated the tail, exactly as a text editor would.
      const op = await readOp(tx, storyId, cursor + 1)
      if (!op) return { ok: true, data: null }

      await applyMutations(tx, redoPlan(op.payload))
      await tx
        .update(stories)
        .set({ undoCursor: cursor + 1, updatedAt: now })
        .where(eq(stories.id, storyId))

      return { ok: true, data: { summary: op.summary } }
    }
  )

  if (result.ok) revalidatePath("/", "layout")
  return result
}

/**
 * Switches which take is active in this entry's slot, by offset (-1 previous,
 * +1 next). A no-op at either end returns ok with null.
 *
 * The neighbour is resolved server-side, from an offset rather than an id, so
 * the client never has to hold the sibling ids: the canvas only ever renders
 * the active take, and shipping the whole slot to it just so it could name the
 * one to switch to would put the manuscript's inactive prose in the page for no
 * other reason.
 *
 * Browsing takes is itself recorded as an op, so ⌘Z steps back through it like
 * anything else. That is deliberate: a writer who clicks past the take they
 * wanted should be able to undo their way back rather than having to work out
 * which direction they came from.
 */
export async function selectVariantByOffset(
  storyId: string,
  entryId: string,
  offset: number
): Promise<ActionResult<{ summary: string } | null>> {
  const db = await getDb()
  const now = new Date().toISOString()

  const result = await db.transaction(
    async (tx): Promise<ActionResult<{ summary: string } | null>> => {
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

      if (!anchor) return { ok: false, error: "Passage not found." }

      // Only the story's last block may change which take it shows. The client
      // renders the switcher on that block alone, but the rule is enforced here
      // too: what the client sends is the one thing a user can forge, and this
      // is the write that would silently rewrite a passage the rest of the
      // story was built on. Same reasoning that keeps regeneration confined to
      // the tail — an earlier block is settled prose, not a live choice.
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
        return {
          ok: false,
          error: "Only the newest passage can switch between takes.",
        }
      }

      // The slot's live takes, in the order the switcher shows them. Deleted
      // takes are excluded: they are not part of the "2 / 3" the writer is
      // reading, so stepping through them would make the readout lie.
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

      // Stepping is measured from whichever take is actually active, not from
      // the id the client sent. They are normally the same row, but a client
      // holding a render from before another tab's switch would otherwise move
      // relative to a take that is no longer showing and jump two places.
      const fromIndex = takes.findIndex((take) => take.isActive)
      if (fromIndex === -1) return { ok: false, error: "Passage not found." }

      const toIndex = fromIndex + offset
      // Off either end, or an offset of zero: nothing to do, and nothing worth
      // telling the writer about — the arrow they pressed was already disabled.
      if (toIndex === fromIndex || toIndex < 0 || toIndex >= takes.length) {
        return { ok: true, data: null }
      }

      const payload: OpPayload = {
        kind: "switch-take",
        variantGroupId: anchor.variantGroupId,
        fromEntryId: takes[fromIndex].id,
        toEntryId: takes[toIndex].id,
      }

      // `redoPlan` is the forward direction of an op, which is exactly what
      // performing it for the first time is — and it deactivates before it
      // activates, which the partial unique index on (story_id, position)
      // requires of every take swap.
      await applyMutations(tx, redoPlan(payload))
      await recordOp(tx, storyId, payload)
      await tx
        .update(stories)
        .set({ updatedAt: now })
        .where(eq(stories.id, storyId))

      return { ok: true, data: { summary: summarize(payload) } }
    }
  )

  if (result.ok) revalidatePath("/", "layout")
  return result
}
