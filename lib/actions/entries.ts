"use server"

import type { OlderEntriesPage } from "@/lib/db/queries"
import { NO_ORIGIN } from "@/lib/services/context"
import * as entries from "@/lib/services/entries"
import type { ActionKind, ActionResult, StoryEntry } from "@/lib/types"

// The bodies live in lib/services/entries.ts. None of these actions took an
// origin, so every call runs as NO_ORIGIN, exactly as the old commitChange
// calls published no origin.

/** Deliberately does not commit; startGeneration owns that. See the service. */
export async function appendActionEntry(
  storyId: string,
  kind: ActionKind,
  rawText: string,
  turnId?: string | null
): Promise<ActionResult<{ entry: StoryEntry }>> {
  return entries.appendActionEntry(
    { storyId, kind, rawText, turnId },
    NO_ORIGIN
  )
}

// `appendGeneratedEntry` used to live here, wrapping persistGeneratedEntry
// with the request-scoped refreshes. The run loop persists through the core
// directly and no request-scoped caller remained, so the wrapper is gone.

/** Run-guarded append for callers that do not own the run; does not commit. */
export async function appendEntryOutsideRun(
  storyId: string,
  mode: "narration" | ActionKind,
  text: string
): Promise<ActionResult<{ entry: StoryEntry }>> {
  return entries.appendEntryOutsideRun({ storyId, mode, text }, NO_ORIGIN)
}

export async function updateActionEntry(
  storyId: string,
  entryId: string,
  rawText: string,
  kind: ActionKind
): Promise<ActionResult> {
  return entries.updateActionEntry(
    { storyId, entryId, rawText, kind },
    NO_ORIGIN
  )
}

export async function updateEntryText(
  storyId: string,
  entryId: string,
  text: string
): Promise<ActionResult> {
  return entries.updateEntryText({ storyId, entryId, text }, NO_ORIGIN)
}

export async function deleteEntry(
  storyId: string,
  entryId: string
): Promise<ActionResult> {
  return entries.deleteEntry({ storyId, entryId }, NO_ORIGIN)
}

export async function rewindToEntry(
  storyId: string,
  entryId: string
): Promise<ActionResult> {
  return entries.rewindToEntry({ storyId, entryId }, NO_ORIGIN)
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

export async function loadOlderEntries(
  storyId: string,
  beforePosition: number,
  limit?: number
): Promise<ActionResult<OlderEntriesPage>> {
  return entries.loadOlderEntries({ storyId, beforePosition, limit }, NO_ORIGIN)
}
