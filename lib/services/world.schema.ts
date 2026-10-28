// lib/services/world.schema.ts — The living world's request and response
// contract: the story clock and what each opted-in NPC remembers and has on
// their mind. Isomorphic: no server imports, so a contract package can lift it.
//
// State is never stored whole. Each finished passage may carry patches, and the
// state at any moment is the fold of the patches whose passage is live, in
// manuscript order. Undo, retry, rewind and switching takes therefore move the
// world with the manuscript without touching the op journal.
import { z } from "zod"

import { entityId } from "@/lib/services/schema"

const storyId = entityId("Invalid story id.")
const loreEntryId = entityId("Invalid lorebook entry id.")
const memoryId = entityId("Invalid memory id.")

/** Minutes in one in-story day. The clock counts minutes from the story's start. */
export const MINUTES_PER_DAY = 1440

/** Longest "on their mind" line a write may set. */
export const MIND_MAX_CHARS = 280
/** Longest single memory a write may add. */
export const MEMORY_MAX_CHARS = 280
/** Longest pacing-rules text a story may hold. */
export const PACING_MAX_CHARS = 2000

const minutes = z
  .number()
  .int("Minutes must be a whole number.")
  .min(0, "Minutes cannot be negative.")

const importance = z
  .number()
  .int("Importance must be a whole number.")
  .min(1, "Importance runs from 1 to 5.")
  .max(5, "Importance runs from 1 to 5.")

// ---------------------------------------------------------------------------
// Story features — stored as stories.features_json.

/** The living-world feature for one story. */
export const worldFeature = z.object({
  enabled: z.boolean().default(false),
  /** Writer-authored rules the clock follows, e.g. "travel between towns takes three days". */
  pacing: z
    .string()
    .max(PACING_MAX_CHARS, "Pacing rules are too long.")
    .default(""),
})

/**
 * Every per-story feature flag. Each later feature adds one optional key here,
 * so a story that predates it parses with the feature absent, meaning off.
 */
export const storyFeatures = z.object({
  world: worldFeature.optional(),
})

export type WorldFeature = z.infer<typeof worldFeature>
export type StoryFeatures = z.infer<typeof storyFeatures>

// ---------------------------------------------------------------------------
// Patch ops — what one patch may change.

export const worldOp = z.discriminatedUnion("type", [
  /** The world pass: time the passage covered. */
  z.object({ type: z.literal("advance-clock"), minutes }),
  /** A correction: put the clock at an absolute time. */
  z.object({ type: z.literal("set-clock"), minutes }),
  z.object({
    type: z.literal("set-mind"),
    loreEntryId,
    mind: z.string().trim().max(MIND_MAX_CHARS, "That thought is too long."),
  }),
  z.object({
    type: z.literal("add-memory"),
    loreEntryId,
    memory: z.object({
      id: memoryId,
      text: z
        .string()
        .trim()
        .min(1, "A memory needs some text.")
        .max(MEMORY_MAX_CHARS, "That memory is too long."),
      importance,
    }),
  }),
  z.object({ type: z.literal("strike-memory"), loreEntryId, memoryId }),
])

export type WorldOp = z.infer<typeof worldOp>

/** Who wrote a patch. "world" is the post-turn pass; "manual" is the inspector or MCP. */
export type WorldPatchSource = "world" | "manual"

// ---------------------------------------------------------------------------
// Folded state — what clients render and the narrator is shown.

export const npcMemory = z.object({
  id: z.string(),
  text: z.string(),
  importance: z.number(),
  /** The clock when the memory was made. */
  minutes: z.number(),
  /** The passage it came from, or null for one added before any passage existed. */
  entryId: z.string().nullable(),
})

export const npcState = z.object({
  loreEntryId: z.string(),
  /** The lorebook entry's name at read time. */
  name: z.string(),
  mind: z.string(),
  /** Oldest first. Struck memories are absent. */
  memories: z.array(npcMemory),
})

export const worldState = z.object({
  storyId: z.string(),
  /** Minutes since the story's start. Day = floor(minutes / MINUTES_PER_DAY) + 1. */
  minutes: z.number(),
  /** Every opted-in NPC, including ones with no state yet, in lorebook name order. */
  npcs: z.array(npcState),
})

export type NpcMemory = z.infer<typeof npcMemory>
export type NpcState = z.infer<typeof npcState>
export type WorldState = z.infer<typeof worldState>

// ---------------------------------------------------------------------------
// Endpoints.

/** GET /api/stories/:storyId/world */
export const getWorldInput = z.object({ storyId })
export const getWorldOutput = z.object({ state: worldState })

/**
 * POST /api/stories/:storyId/world/patch — a manual correction, anchored to
 * the story's latest live passage, so undoing past that passage undoes it too.
 * "advance-clock" is the world pass's op and is refused here.
 */
export const applyWorldPatchInput = z.object({
  storyId,
  ops: z
    .array(worldOp)
    .min(1, "A patch needs at least one change.")
    .refine(
      (ops) => ops.every((op) => op.type !== "advance-clock"),
      "Set the clock instead of advancing it."
    ),
})
export const applyWorldPatchOutput = z.object({ state: worldState })

export type GetWorldInput = z.input<typeof getWorldInput>
export type ApplyWorldPatchInput = z.input<typeof applyWorldPatchInput>

/** The post-passage model's complete answer. Presence is checked against its input. */
export const worldPassOutput = z.object({
  minutesElapsed: minutes,
  minuteOfDay: z.number().int().min(0).max(1439).optional(),
  npcs: z.array(
    z.object({
      loreEntryId,
      mind: z.string().trim().max(MIND_MAX_CHARS),
      memories: z.array(
        z.object({
          text: z.string().trim().min(1).max(MEMORY_MAX_CHARS),
          importance,
        })
      ),
    })
  ),
})
