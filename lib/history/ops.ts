// lib/history/ops.ts — The undo/redo model, as pure data.
//
// Every history-changing move is recorded as an *op*: a small JSON payload
// naming the rows involved. Undo and redo translate that payload into row
// mutations, which lib/db/journal.ts is the only module allowed to execute.
// Kept pure so the interesting cases are testable without a database.

import type { ActionKind } from "@/lib/types"

/** Stored verbatim in `story_ops.kind`. */
export type OpKind =
  "turn" | "edit" | "delete" | "retry" | "switch-take" | "rewind"

/**
 * The writer's action and the passage it produced, under one op so ⌘Z takes
 * back both at once. Either half may be null: a Continue has no user half, and
 * a generation that died mid-stream has no generated half.
 */
export interface TurnPayload {
  kind: "turn"
  userEntryId: string | null
  generatedEntryId: string | null
}

/** The whole of what an edit can change, so before/after is enough to undo it. */
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

/** `previousEntryId` was deactivated, `newEntryId` inserted into the same slot. */
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

/**
 * Everything after one passage, cut in a single move.
 *
 * The ids are enumerated at rewind time rather than stored as "every entry past
 * position N": positions are not the identity of a passage, and a rewind has to
 * put back exactly what it took — not whatever happens to sit past that
 * position when the writer presses ⌘Z. Only the takes that were actually
 * showing are listed; the inactive siblings of a cut slot were already
 * invisible, so leaving them alone is what makes undo land on the state the
 * writer rewound from rather than a slot with two live takes in it.
 */
export interface RewindPayload {
  kind: "rewind"
  entryIds: string[]
}

export type OpPayload =
  | TurnPayload
  | EditPayload
  | DeletePayload
  | RetryPayload
  | SwitchTakePayload
  | RewindPayload

export type EntryMutation =
  | { type: "set-deleted"; entryId: string; deleted: boolean }
  | { type: "set-active"; entryId: string; active: boolean }
  | { type: "set-prose"; entryId: string; prose: EntryProse }

/** The mutations that reverse an op, in the order they must be applied. */
export function undoPlan(payload: OpPayload): EntryMutation[] {
  switch (payload.kind) {
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
    // The retried take stays on disk, just inactive, so it is still reachable.
    case "retry":
      return takeSwap(payload.newEntryId, payload.previousEntryId)
    case "switch-take":
      return takeSwap(payload.toEntryId, payload.fromEntryId)
    // The whole tail comes back at once, which is the point: a rewind is one
    // move to the writer, so it is one ⌘Z.
    case "rewind":
      return payload.entryIds.map((entryId) => ({
        type: "set-deleted" as const,
        entryId,
        deleted: false,
      }))
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
    case "rewind":
      return payload.entryIds.map((entryId) => ({
        type: "set-deleted" as const,
        entryId,
        deleted: true,
      }))
  }
}

/**
 * Moves the active flag between two takes, always deactivating first.
 *
 * All takes of a slot share one `position`, and the unique index over
 * (story_id, position) covers live+active rows. Activating first would leave
 * two active rows at that position for one statement, which Postgres rejects.
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

/** Writer-facing name for the undo/redo tooltips ("Undo · Retry"). */
export function summarize(payload: OpPayload): string {
  switch (payload.kind) {
    // Without a user half it was a bare Continue, not a Say or a Do.
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
    // The only op whose size is not obvious from the manuscript — the passages
    // it took are gone from the page — so the count goes in the phrase the
    // undo tooltip shows.
    case "rewind":
      return payload.entryIds.length === 1
        ? "Rewind 1 passage"
        : `Rewind ${payload.entryIds.length} passages`
  }
}

/**
 * Merges a new edit into the previous op when it edits the same entry, keeping
 * the earliest `before` so undo returns to how the block read before the
 * fiddling started. Null when they must not merge.
 *
 * Deliberately narrow: anything between the two edits — a turn, a delete, an
 * edit of another passage — is a boundary the writer would expect to stop at.
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
 * Parses a stored `payload_json`, or null when it cannot be trusted. Null
 * rather than a throw: a corrupt op must degrade to "undo is unavailable", not
 * take the story page down with it.
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
  // Only the discriminant is checked. These rows are written by this module and
  // never by a user, so the realistic failures are a truncated write or a kind
  // from a newer build — both caught here.
  if (
    kind === "turn" ||
    kind === "edit" ||
    kind === "delete" ||
    kind === "retry" ||
    kind === "switch-take" ||
    kind === "rewind"
  ) {
    return parsed as OpPayload
  }
  return null
}
