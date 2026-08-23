"use server"

import { and, eq, gt, isNull } from "drizzle-orm"

import { commitChange } from "@/lib/actions/commit"
import { getDb } from "@/lib/db/client"
import { listOlderEntries, type OlderEntriesPage } from "@/lib/db/queries"
import { appendEntryCore, touchStoryRow } from "@/lib/db/entry-writes"
import { recordOp } from "@/lib/db/journal"
import { storyEntries } from "@/lib/db/schema"
import { refuseDuringRun } from "@/lib/generation/live"
import type { EntryProse } from "@/lib/history/ops"
import { translateAction } from "@/lib/story/action-voice"
import type { ActionKind, ActionResult, StoryEntry } from "@/lib/types"

// The append/persist cores live in lib/db/entry-writes.ts: the generation run
// loop persists passages from a detached task with no request scope, where
// revalidatePath throws. The actions here wrap those cores with the two
// refreshes a request-scoped write owes — commitChange, after the commit and
// never inside it, because the cache must not be promised rows a rollback
// took back.

/** The prose columns an `edit` op has to carry, as they read right now. */
function proseOf(row: {
  text: string
  actionKind: ActionKind | null
  inputText: string | null
}): EntryProse {
  return {
    text: row.text,
    actionKind: row.actionKind,
    inputText: row.inputText,
  }
}

/**
 * Appends the writer's turn: they type first person, the page reads second.
 *
 * The translation runs *here* rather than arriving pre-translated from the
 * client, because what the client sends is the one thing a user can forge and
 * the stored prose is what the model is conditioned on for the rest of the
 * story. The composer runs the same pure function purely for its optimistic
 * echo; this row is the authority, and if the two ever disagree the client's
 * copy is the one that gets replaced.
 *
 * Both blanks are rejected: an empty raw input is nothing to submit, and a raw
 * input that translates to nothing (whitespace, punctuation the transform
 * strips) would otherwise write an empty passage the writer can only find by
 * scrolling into it.
 *
 * Deliberately does NOT revalidate, and its one caller (startGeneration) owns
 * that instead. This insert sits in the critical path between the writer
 * pressing Send and the first token: revalidating here makes the server
 * re-render the whole layout and ship it back before generation can even start,
 * for a row the canvas is already showing a byte-identical echo of. useGeneration
 * refreshes the tree exactly once, when the turn settles — and on every failure
 * path too, so this row can never stay invisible.
 */
export async function appendActionEntry(
  storyId: string,
  kind: ActionKind,
  rawText: string,
  turnId?: string | null
): Promise<ActionResult<{ entry: StoryEntry }>> {
  const raw = rawText.trim()
  if (raw === "")
    return { ok: false, error: "Nothing to add — write something first." }

  const translated = translateAction(kind, raw)
  if (translated.trim() === "")
    return { ok: false, error: "Nothing to add — write something first." }

  return appendEntryCore(storyId, translated, "user", {
    action: { kind, inputText: raw },
    turnId,
  })
}

// `appendGeneratedEntry` used to live here, wrapping persistGeneratedEntry
// with the request-scoped refreshes. The run loop persists through the core
// directly and no request-scoped caller remained, so the wrapper is gone.

/**
 * Re-edits a player turn: the writer edits their own first-person input again,
 * and both columns are rewritten from it so the stored prose stays exactly
 * `translateAction(actionKind, inputText)`. Editing the translated text
 * directly (updateEntryText) would break that pair, leaving an inputText that
 * no longer explains the passage sitting beside it.
 *
 * The kind is read from the row rather than taken from the caller: it was
 * chosen when the turn was written and an edit is not a place to silently turn
 * a Do into a Say. A row without one is not a player turn at all — a generated
 * passage, or a user passage from before this feature — and there is nothing to
 * re-translate, so those go through updateEntryText.
 */
export async function updateActionEntry(
  storyId: string,
  entryId: string,
  rawText: string
): Promise<ActionResult> {
  // Same threat model as deleteEntry: only a device that isn't mirroring the
  // run has this control lit, and its mid-run edit records an op the run's own
  // recordOp then can't fold the turn into.
  const running = refuseDuringRun(storyId)
  if (running) return running
  const raw = rawText.trim()
  if (raw === "") return { ok: false, error: "A passage can't be empty." }

  const db = await getDb()
  const now = new Date().toISOString()

  const result = await db.transaction(async (tx): Promise<ActionResult> => {
    // Inside the transaction, and the whole prose: the kind decides how to
    // translate, and the rest is the `before` undo has to put back. Reading it
    // outside would let another tab's edit land in between and be swallowed.
    const existing = await tx
      .select({
        text: storyEntries.text,
        actionKind: storyEntries.actionKind,
        inputText: storyEntries.inputText,
      })
      .from(storyEntries)
      .where(
        and(eq(storyEntries.id, entryId), eq(storyEntries.storyId, storyId))
      )
      .limit(1)
      .then((rows) => rows[0])

    if (!existing) return { ok: false, error: "Passage not found." }
    if (existing.actionKind === null)
      return { ok: false, error: "This passage isn't a Say or Do." }

    const translated = translateAction(existing.actionKind, raw)
    if (translated.trim() === "")
      return { ok: false, error: "A passage can't be empty." }

    // The SELECT above read the prose, not a lock: the row can be soft-deleted
    // between the two statements (another tab's Delete), so the update has to
    // prove it landed the same way every other mutator here does.
    const updated = await tx
      .update(storyEntries)
      .set({ text: translated, inputText: raw })
      .where(
        and(eq(storyEntries.id, entryId), eq(storyEntries.storyId, storyId))
      )
      .returning({ id: storyEntries.id })

    if (updated.length === 0) return { ok: false, error: "Passage not found." }

    await recordOp(tx, storyId, {
      kind: "edit",
      entryId,
      before: proseOf(existing),
      // Kind carried through unchanged: this path re-translates, never re-voices.
      after: {
        text: translated,
        actionKind: existing.actionKind,
        inputText: raw,
      },
    })
    await touchStoryRow(tx, storyId, now)

    return { ok: true, data: null }
  })

  if (result.ok) commitChange(storyId)
  return result
}

/**
 * Edits a passage's prose directly. Correct for generated passages and for
 * user passages predating Say/Do; player turns use updateActionEntry so the
 * translation and its raw input cannot drift apart.
 *
 * Writing prose here also clears actionKind/inputText, which is what the
 * editor's "Edit prose instead" hatch relies on: the moment a writer hand-fixes
 * the rendered sentence, the row stops being a translation of anything and
 * becomes ordinary prose. Leaving the pair behind would strand an inputText
 * that no longer explains the passage — and reopening the editor would seed
 * from it and re-translate the hand-fix away on the next save. Unconditional is
 * safe: both columns are already null on generated and legacy rows.
 *
 * The `before` recorded for undo carries all three columns for that reason:
 * undoing a hand-fix has to give the writer their Say back.
 */
export async function updateEntryText(
  storyId: string,
  entryId: string,
  text: string
): Promise<ActionResult> {
  // See updateActionEntry — an edit landing mid-run on a take being retried
  // rewrites prose the run is about to deactivate anyway.
  const running = refuseDuringRun(storyId)
  if (running) return running
  const trimmed = text.trim()
  if (trimmed === "") return { ok: false, error: "A passage can't be empty." }

  const db = await getDb()
  const now = new Date().toISOString()

  const result = await db.transaction(async (tx): Promise<ActionResult> => {
    const existing = await tx
      .select({
        text: storyEntries.text,
        actionKind: storyEntries.actionKind,
        inputText: storyEntries.inputText,
      })
      .from(storyEntries)
      .where(
        and(eq(storyEntries.id, entryId), eq(storyEntries.storyId, storyId))
      )
      .limit(1)
      .then((rows) => rows[0])

    if (!existing) return { ok: false, error: "Passage not found." }

    const updated = await tx
      .update(storyEntries)
      .set({ text: trimmed, actionKind: null, inputText: null })
      .where(
        and(eq(storyEntries.id, entryId), eq(storyEntries.storyId, storyId))
      )
      .returning({ id: storyEntries.id })

    if (updated.length === 0) return { ok: false, error: "Passage not found." }

    await recordOp(tx, storyId, {
      kind: "edit",
      entryId,
      before: proseOf(existing),
      after: { text: trimmed, actionKind: null, inputText: null },
    })
    await touchStoryRow(tx, storyId, now)

    return { ok: true, data: null }
  })

  if (result.ok) commitChange(storyId)
  return result
}

/**
 * Removes a passage — a soft delete, never a DELETE. The row keeps its
 * `position`, so undo is a single UPDATE back to NULL and nothing is
 * renumbered.
 *
 * Already-deleted rows are excluded rather than treated as a success: a second
 * Delete would otherwise record a second op, and undoing it would restore a
 * passage the writer deleted twice and expected to stay gone.
 */
export async function deleteEntry(
  storyId: string,
  entryId: string
): Promise<ActionResult> {
  // Same guard as the history walkers (see lib/actions/history.ts): a delete
  // from a device that isn't mirroring the run can soft-delete the take the
  // run is about to persist beside, and the billed passage is refused.
  const running = refuseDuringRun(storyId)
  if (running) return running
  const db = await getDb()
  const now = new Date().toISOString()

  const result = await db.transaction(async (tx): Promise<ActionResult> => {
    const deleted = await tx
      .update(storyEntries)
      .set({ deletedAt: now })
      .where(
        and(
          eq(storyEntries.id, entryId),
          eq(storyEntries.storyId, storyId),
          isNull(storyEntries.deletedAt)
        )
      )
      .returning({ id: storyEntries.id })

    if (deleted.length === 0) return { ok: false, error: "Passage not found." }

    await recordOp(tx, storyId, { kind: "delete", entryId })
    await touchStoryRow(tx, storyId, now)

    return { ok: true, data: null }
  })

  if (result.ok) commitChange(storyId)
  return result
}

/**
 * Rewinds the manuscript to one passage: every live passage AFTER it leaves the
 * story, the anchor itself stays, and the whole cut is one op — so one ⌘Z puts
 * the tail back and ⌘⇧Z takes it away again.
 *
 * Soft deletes, like every other removal here, and positions are kept. That is
 * what makes the undo safe: `nextPosition` counts deleted rows too, so passages
 * written after a rewind take fresh numbers and can never collide with the ones
 * the rewind is holding.
 *
 * Only the takes that were showing are cut. An inactive sibling of a rewound
 * slot is already invisible, and leaving it alone means undo restores the slot
 * exactly as the writer left it rather than as a slot with two live takes.
 *
 * Note this is NOT the "Retry from here" that used to live below. Nothing is
 * regenerated and nothing branches: the writer is choosing where the story
 * ends, and the passages after it are reversibly set aside.
 */
export async function rewindToEntry(
  storyId: string,
  entryId: string
): Promise<ActionResult> {
  // Same guard as deleteEntry, and the one that matters most here: a rewind
  // from a device that isn't mirroring the run would cut the tail the run is
  // still writing into, and the passage the writer is paying for is dropped.
  const running = refuseDuringRun(storyId)
  if (running) return running

  const db = await getDb()
  const now = new Date().toISOString()

  const result = await db.transaction(async (tx): Promise<ActionResult> => {
    // The anchor has to be a passage the writer can actually see: rewinding to
    // a deleted row or an inactive take would cut from a position nothing is
    // rendered at, and the count in the confirmation would have been a guess
    // about a different manuscript.
    const anchor = await tx
      .select({ position: storyEntries.position })
      .from(storyEntries)
      .where(
        and(
          eq(storyEntries.id, entryId),
          eq(storyEntries.storyId, storyId),
          eq(storyEntries.isActive, true),
          isNull(storyEntries.deletedAt)
        )
      )
      .limit(1)
      .then((rows) => rows[0])

    if (!anchor) return { ok: false, error: "Passage not found." }

    // One statement, and the ids come back from it: a SELECT-then-UPDATE would
    // record an op naming rows a concurrent delete had already taken, and undo
    // would then restore a passage the writer deleted on another device.
    const removed = await tx
      .update(storyEntries)
      .set({ deletedAt: now })
      .where(
        and(
          eq(storyEntries.storyId, storyId),
          gt(storyEntries.position, anchor.position),
          eq(storyEntries.isActive, true),
          isNull(storyEntries.deletedAt)
        )
      )
      .returning({ id: storyEntries.id })

    // The button is only rendered on a passage with prose after it, so this is
    // a stale render or a forged call — and an op naming no rows would be an
    // undo step that does nothing when taken.
    if (removed.length === 0)
      return { ok: false, error: "There's nothing after this passage." }

    await recordOp(tx, storyId, {
      kind: "rewind",
      entryIds: removed.map((row) => row.id),
    })
    await touchStoryRow(tx, storyId, now)

    return { ok: true, data: null }
  })

  if (result.ok) commitChange(storyId)
  return result
}

// `undoLastEntry` and `deleteEntriesFrom` used to live here. Both are gone on
// purpose.
//
// undoLastEntry deleted the newest row. Undo is now a journal that reverses the
// writer's last *move*, which is often more than one row — a second "delete the
// last row" action would be a disagreeing notion of undo.
//
// deleteEntriesFrom powered "Retry from here", truncating the manuscript from a
// chosen block so a new generation could replace it. That is branching, which
// this design removes: regeneration is confined to the last block, where a
// retry adds a take beside the one showing and nothing downstream is destroyed.
// rewindToEntry above truncates too, and is deliberately not that feature: it
// generates nothing, so there is no second version of the story to reconcile,
// and the cut is a single journal op the writer can take back.

/** How many passages one scroll-up fetch brings in. Sized for the COMMIT,
 * not the wire: mounting a page of passages is the expensive half of a
 * landing, and the fetch-ahead pipeline in the canvas keeps the next page
 * buffered, so smaller pages cost nothing in throughput. */
const OLDER_PAGE_SIZE = 25

/**
 * One page of older passages for the canvas, walking backward from the
 * loaded window's start. A pure read: no revalidate, no journal — paging
 * through the manuscript is not a change to it.
 */
export async function loadOlderEntries(
  storyId: string,
  beforePosition: number,
  limit?: number
): Promise<ActionResult<OlderEntriesPage>> {
  try {
    const page = await listOlderEntries(
      storyId,
      beforePosition,
      // Clamped: `limit` is client input, and the one caller that passes it
      // (the staleness refetch) asks for exactly what it already holds.
      Math.max(1, Math.min(limit ?? OLDER_PAGE_SIZE, 500))
    )
    return { ok: true, data: page }
  } catch {
    return { ok: false, error: "Could not load earlier passages." }
  }
}
