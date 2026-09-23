// lib/services/entries.schema.ts — The manuscript's passage contract: appends,
// edits, removals, paging and the per-passage context viewer. Isomorphic: no
// server imports, so a contract package can lift it.
import { z } from "zod"

import type { ComposedContext } from "@/lib/generation/types"
import { entityId } from "@/lib/services/schema"

const NOTHING_TO_ADD = "Nothing to add — write something first."
const EMPTY_PASSAGE = "A passage can't be empty."

const storyId = entityId("Invalid story id.")
const entryId = entityId("Invalid entry id.")
const actionKind = z.enum(["say", "do"], { error: "Unknown action kind." })

// Keys are ordered as the old actions checked them; see parseInput. The old
// actions never checked ids at all, so the id fields come last.

export const appendActionEntryInput = z.object({
  rawText: z.string({ error: NOTHING_TO_ADD }).trim().min(1, NOTHING_TO_ADD),
  kind: actionKind,
  storyId,
  // Makes the Send and its generated passage one undo step; see recordOp.
  turnId: z.string().nullable().optional(),
})

export const appendEntryOutsideRunInput = z.object({
  mode: z.enum(["narration", "say", "do"], { error: "Unknown action kind." }),
  // Not trimmed here: narration is trimmed and refused by appendEntryCore, a
  // do/say by appendActionEntry, each with its own sentence.
  text: z.string({ error: NOTHING_TO_ADD }),
  storyId,
})

export const updateActionEntryInput = z.object({
  kind: actionKind,
  rawText: z.string({ error: EMPTY_PASSAGE }).trim().min(1, EMPTY_PASSAGE),
  storyId,
  entryId,
})

export const updateEntryTextInput = z.object({
  text: z.string({ error: EMPTY_PASSAGE }).trim().min(1, EMPTY_PASSAGE),
  storyId,
  entryId,
})

export const deleteEntryInput = z.object({ storyId, entryId })

export const rewindToEntryInput = z.object({ storyId, entryId })

export const loadOlderEntriesInput = z.object({
  storyId,
  beforePosition: z.number({ error: "Invalid position." }),
  // Clamped by the service rather than refused, as the old action did.
  limit: z.number({ error: "Invalid limit." }).optional(),
})

export const loadEntryContextInput = z.object({ storyId, entryId })

const entryGeneration = z.object({
  modelId: z.string(),
  thinking: z.string(),
  temperature: z.number(),
  profileName: z.string().nullable(),
  promptTokens: z.number().nullable(),
  completionTokens: z.number().nullable(),
})

export const storyEntry = z.object({
  id: z.string(),
  position: z.number().optional(),
  source: z.enum(["user", "generated"]),
  text: z.string(),
  actionKind: z.enum(["say", "do"]).nullable(),
  inputText: z.string().nullable(),
  variantGroupId: z.string(),
  variantIndex: z.number(),
  variantCount: z.number(),
  variantProfilesMixed: z.boolean(),
  generation: entryGeneration.nullable(),
  // A decimal string straight out of Postgres, never a float.
  costUsd: z.string().nullable(),
  reasoningTokens: z.number().nullable(),
  callStatus: z.string().nullable(),
  createdAt: z.string(),
})

export const appendEntryOutput = z.object({ entry: storyEntry })

/** The edits, the delete and the rewind answer with no data. */
export const entryWriteOutput = z.null()

export const olderEntriesPageOutput = z.object({
  entries: z.array(storyEntry),
  windowStartPosition: z.number().nullable(),
  hasMore: z.boolean(),
})

const loreTrigger = z.union([
  z.object({ kind: z.literal("source"), source: z.string() }),
  z.object({ kind: z.literal("lore"), id: z.string(), name: z.string() }),
])

export const composedContext = z.object({
  systemPrompt: z.string(),
  memory: z.string(),
  lore: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      content: z.string(),
      priority: z.number(),
      matchedKey: z.string().nullable(),
      depth: z.number(),
      triggeredBy: loreTrigger.nullable(),
      stable: z.boolean(),
    })
  ),
  summary: z.string(),
  storyText: z.string(),
  authorsNote: z.string(),
  seed: z.number(),
  approxTokens: z.number(),
  fit: z.object({
    loreMatched: z.number(),
    loreStableMatched: z.number(),
    storyChars: z.number(),
    storyCharsKept: z.number(),
  }),
  trim: z.object({ windowStart: z.number(), quantum: z.number() }),
})

/**
 * Null is the ordinary answer for a passage no longer in the manuscript
 * (deleted, or an inactive take), not a failure.
 */
export const entryContextOutput = z
  .object({
    context: composedContext,
    contextWindow: z.number(),
    modelId: z.string().nullable(),
  })
  .nullable()

/** A passage's context, composed on demand. */
export interface EntryContext {
  context: ComposedContext
  /** The budget it was composed against — clamped the way a real request is. */
  contextWindow: number
  /** The model that wrote the passage. Null when the row never recorded one. */
  modelId: string | null
}

export type AppendActionEntryInput = z.input<typeof appendActionEntryInput>
export type AppendEntryOutsideRunInput = z.input<
  typeof appendEntryOutsideRunInput
>
export type UpdateActionEntryInput = z.input<typeof updateActionEntryInput>
export type UpdateEntryTextInput = z.input<typeof updateEntryTextInput>
export type DeleteEntryInput = z.input<typeof deleteEntryInput>
export type RewindToEntryInput = z.input<typeof rewindToEntryInput>
export type LoadOlderEntriesInput = z.input<typeof loadOlderEntriesInput>
export type LoadEntryContextInput = z.input<typeof loadEntryContextInput>
