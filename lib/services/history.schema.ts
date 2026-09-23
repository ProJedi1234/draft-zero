// lib/services/history.schema.ts — The contract for walking a story's history:
// undo, redo, and switching the newest passage's take. Isomorphic.
import { z } from "zod"

import { entityId } from "@/lib/services/schema"

const storyId = entityId("Invalid story id.")

export const undoStoryOpInput = z.object({ storyId })
export const redoStoryOpInput = z.object({ storyId })

export const selectVariantInput = z.object({
  storyId,
  entryId: entityId("Invalid entry id."),
  offset: z.number({ error: "Invalid offset." }).int("Invalid offset."),
})

/** What the move did, or null when there was nothing to do. */
export const historyMoveOutput = z.object({ summary: z.string() }).nullable()

export type UndoStoryOpInput = z.input<typeof undoStoryOpInput>
export type RedoStoryOpInput = z.input<typeof redoStoryOpInput>
export type SelectVariantInput = z.input<typeof selectVariantInput>
