// lib/services/generation.schema.ts — The contract for starting and stopping a
// server-owned generation run. Isomorphic: no server imports.
import { z } from "zod"

import { entityId } from "@/lib/services/schema"

const storyId = entityId("Invalid story id.")

/** Keys are ordered as the old action checked them; see parseInput. */
export const startGenerationInput = z.object({
  storyId,
  kind: z.enum(["say", "do"], { error: "Unknown action kind." }).optional(),
  userText: z
    .string({ error: "Nothing to add — write something first." })
    .optional(),
  turnId: z.string().optional(),
  variantGroupId: z.string().optional(),
  /** Ids the run supersedes (retry's old take) — echoed on the RunFrame for late attachers. */
  removingEntryIds: z.array(z.string()).optional(),
  // Any string on purpose: a kind the client may not name falls back to
  // "generate" in the service, as it always has, rather than failing the Send.
  requestKind: z.string().optional(),
  /**
   * Generate this one passage under a named profile instead of the story's
   * own settings. Nothing is written back to the story row: a writer trying
   * another model on a paragraph is asking a question about the paragraph,
   * not changing what the story follows — the inspector stays the only place
   * that changes. Retry is the only move that offers it today.
   */
  profileId: z.string().optional(),
})

export const startGenerationOutput = z.object({
  runId: z.string(),
  userEntryId: z.string().nullable(),
})

export const stopGenerationInput = z.object({
  storyId,
  runId: z.string().nullish(),
  startTurnId: z.string().nullish(),
})

export const stopGenerationOutput = z.null()

export type StartGenerationInput = z.input<typeof startGenerationInput>
export type StopGenerationInput = z.input<typeof stopGenerationInput>
