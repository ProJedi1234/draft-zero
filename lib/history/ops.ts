// lib/history/ops.ts — The undo/redo model, expressed as pure data.
//
// Every history-changing thing the writer can do is recorded as an *op*: a
// small JSON payload naming the rows involved, never the prose that the rows
// happen to hold at the moment (except for `edit`, where the prose IS the
// change). Undoing and redoing then become a translation from that payload
// into a list of row mutations, which lib/db/journal.ts is the only module
// allowed to execute.
//
// Keeping that translation here, pure and dependency-free, is deliberate: this
// is where the interesting bugs would otherwise live, buried inside a server
// action next to a transaction and a revalidatePath and therefore only
// reachable through the database. Here it is a total function from a payload
// to an array, and the test suite can pin every kind in both directions.
//
// Two invariants of the feature show through everywhere below:
//
// 1. Nothing is destroyed. A passage is soft-deleted (`deleted_at`) or
//    deactivated (`is_active`), never removed, so every op is reversible by
//    flipping a flag back.
// 2. There is no branching. Only the last block can be regenerated, which is
//    why no plan here ever has to reason about a tree of alternative futures.

import type { ActionKind } from "@/lib/types"

/** The kinds of op the journal can hold. Stored verbatim in `story_ops.kind`. */
export type OpKind = "turn" | "edit" | "delete" | "retry" | "switch-take"

/**
 * A turn: the writer's action (if any) and the passage it produced (if any).
 *
 * Both halves are nullable and both are recorded under one op on purpose. A
 * Send writes the user's action immediately and the generated passage only
 * when the stream finishes, but to the writer that was a single move, so ⌘Z
 * must take back both at once. The journal upserts the two halves onto one row
 * keyed by `turnId`; by the time the turn is over, either or both ids may be
 * set — a bare "Continue" has no user half, and a generation that failed
 * before producing text has no generated half.
 */
export interface TurnPayload {
  kind: "turn"
  userEntryId: string | null
  generatedEntryId: string | null
}

/**
 * The editable prose of one passage. This is the whole of what an edit can
 * change, so an `edit` op that carries a before and an after of this shape is
 * complete: undo needs nothing else to restore the passage exactly.
 */
export interface EntryProse {
  text: string
  actionKind: ActionKind | null
  inputText: string | null
}

export interface EditPayload {
  kind: "edit"
  entryId: string
  before: EntryProse
  after: EntryProse
}

export interface DeletePayload {
  kind: "delete"
  entryId: string
}

/**
 * A retry: `previousEntryId` was deactivated, `newEntryId` inserted into the
 * same slot.
 */
export interface RetryPayload {
  kind: "retry"
  variantGroupId: string
  previousEntryId: string
  newEntryId: string
}

/** The writer stepped between two existing takes of one slot. */
export interface SwitchTakePayload {
  kind: "switch-take"
  variantGroupId: string
  fromEntryId: string
  toEntryId: string
}

export type OpPayload =
  TurnPayload | EditPayload | DeletePayload | RetryPayload | SwitchTakePayload

/**
 * A single row mutation. lib/db/journal.ts is the only thing that executes
 * these; everything upstream of it deals in plans, which are inspectable and
 * testable in a way that a half-built SQL statement is not.
 */
export type EntryMutation =
  | { type: "set-deleted"; entryId: string; deleted: boolean }
  | { type: "set-active"; entryId: string; active: boolean }
  | { type: "set-prose"; entryId: string; prose: EntryProse }

/**
 * The mutations that reverse an op, in the order they must be applied.
 *
 * Ordering is load-bearing wherever `is_active` moves between two rows: see
 * the note above `takeSwap` below.
 */
export function undoPlan(payload: OpPayload): EntryMutation[] {
  switch (payload.kind) {
    // A turn is undone by soft-deleting whichever halves it produced. Both may
    // be present, or only one; the nulls are skipped rather than treated as an
    // error, because a turn that died mid-stream is an ordinary outcome and
    // its user half still has to be undoable.
    case "turn":
      return turnEntryIds(payload).map((entryId) => ({
        type: "set-deleted" as const,
        entryId,
        deleted: true,
      }))
    case "edit":
      return [
        { type: "set-prose", entryId: payload.entryId, prose: payload.before },
      ]
    case "delete":
      return [{ type: "set-deleted", entryId: payload.entryId, deleted: false }]
    // Undoing a retry puts the slot back on the take that was active before it,
    // and leaves the new take in place but inactive — nothing is destroyed, so
    // the writer can still reach the retried prose through the take switcher.
    case "retry":
      return takeSwap(payload.newEntryId, payload.previousEntryId)
    case "switch-take":
      return takeSwap(payload.toEntryId, payload.fromEntryId)
  }
}

/** The mutations that reapply an op, in the order they must be applied. */
export function redoPlan(payload: OpPayload): EntryMutation[] {
  switch (payload.kind) {
    case "turn":
      return turnEntryIds(payload).map((entryId) => ({
        type: "set-deleted" as const,
        entryId,
        deleted: false,
      }))
    case "edit":
      return [
        { type: "set-prose", entryId: payload.entryId, prose: payload.after },
      ]
    case "delete":
      return [{ type: "set-deleted", entryId: payload.entryId, deleted: true }]
    case "retry":
      return takeSwap(payload.previousEntryId, payload.newEntryId)
    case "switch-take":
      return takeSwap(payload.fromEntryId, payload.toEntryId)
  }
}

/**
 * Move the active flag from one take of a slot to another — always
 * **deactivating before activating**.
 *
 * The order is not cosmetic. The unique index on `(story_id, position)` is
 * partial, covering exactly the rows that are live and active, and all takes of
 * one slot share a single `position`. Activating the incoming take first would
 * leave two active rows at that position for the width of one statement, and
 * Postgres checks the index per statement, so the write would be rejected
 * outright. Deactivate first and the slot is momentarily empty instead, which
 * the index is perfectly happy with.
 */
function takeSwap(deactivateId: string, activateId: string): EntryMutation[] {
  return [
    { type: "set-active", entryId: deactivateId, active: false },
    { type: "set-active", entryId: activateId, active: true },
  ]
}

/** The ids a turn actually produced, dropping the halves it never got to. */
function turnEntryIds(payload: TurnPayload): string[] {
  return [payload.userEntryId, payload.generatedEntryId].filter(
    (id): id is string => id !== null
  )
}

/**
 * A writer-facing name for an op, shown in the undo and redo tooltips ("Undo ·
 * Retry"). Deliberately a fixed phrase per kind rather than a sentence quoting
 * the prose: the tooltip has to fit next to an icon button, and a writer who
 * needs to know *which* passage is about to change is better served by looking
 * at the manuscript.
 */
export function summarize(payload: OpPayload): string {
  switch (payload.kind) {
    // A turn with a user half was a Say or a Do; without one it was a bare
    // Continue, and calling that "Your turn" would be a small lie.
    case "turn":
      return payload.userEntryId ? "Your turn" : "Continue"
    case "edit":
      return "Edit"
    case "delete":
      return "Delete passage"
    case "retry":
      return "Retry"
    case "switch-take":
      return "Switch take"
  }
}

/**
 * Merge a new edit into the previous op when it edits the same entry, keeping
 * the EARLIEST `before` — so undo returns to how the block read before the
 * fiddling started. Returns null when they must not merge.
 *
 * Without this, an editing session becomes one undo step per keystroke-flush,
 * and ⌘Z stops being a way back to a known state. The rule is intentionally
 * narrow: only an immediately preceding edit of the same entry absorbs the new
 * one. Anything else between them — a turn, a delete, an edit of a different
 * passage — is a real boundary the writer would expect to stop at.
 */
export function coalesceEdit(
  previous: OpPayload,
  next: EditPayload
): EditPayload | null {
  if (previous.kind !== "edit" || previous.entryId !== next.entryId) {
    return null
  }
  return { ...next, before: previous.before }
}

/**
 * Parse a stored `payload_json` back into an op, or null when it cannot be
 * trusted.
 *
 * Null rather than a throw is the whole point: a corrupt or
 * written-by-a-future-version op must degrade to "undo is unavailable", never
 * to an exception escaping a server action and taking the story page with it.
 * Callers treat null as an opaque wall in the history and stop there.
 */
export function parsePayload(json: string): OpPayload | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return null
  }
  if (typeof parsed !== "object" || parsed === null) return null
  const kind = (parsed as { kind?: unknown }).kind
  // Only the discriminant is checked, not the whole shape. The rows are written
  // by this same module and never by a user, so the realistic failure is a
  // truncated write or an op kind from a newer build — both caught here — and
  // hand-rolling a validator per payload would be ceremony guarding against a
  // case that cannot arise.
  if (
    kind === "turn" ||
    kind === "edit" ||
    kind === "delete" ||
    kind === "retry" ||
    kind === "switch-take"
  ) {
    return parsed as OpPayload
  }
  return null
}
