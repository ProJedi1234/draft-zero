// lib/services/stories.schema.ts — The story row's request and response
// contract. Isomorphic: no server imports, so a contract package can lift it.
import { z } from "zod"

import { entityId } from "@/lib/services/schema"
import {
  isContextWindow,
  REASONING_EFFORTS,
  type ThinkingLevel,
} from "@/lib/types"

const INVALID_STORY_ID = "Invalid story id."

/**
 * Ids of stories that already exist are not shape-checked, because the old
 * actions never did: an id no row carries simply finds nothing.
 */
const existingStoryId = z.string({ error: INVALID_STORY_ID })

/** A client-minted id for a new row, checked the way the store checks ids. */
const newStoryId = entityId(INVALID_STORY_ID)

/**
 * Any JS number, NaN and the infinities included. z.number() refuses those,
 * but the tint write clamps them and the settings write stored them as given.
 */
function anyNumber(message: string) {
  return z.custom<number>((value) => typeof value === "number", message)
}

const thinkingLevels = ["off", ...REASONING_EFFORTS] as [
  ThinkingLevel,
  ...ThinkingLevel[],
]

export const loadStoryPageInput = z.object({
  offset: z
    .number({ error: "Invalid offset." })
    .int("Invalid offset.")
    .min(0, "Invalid offset."),
  query: z.string().optional(),
})

export const createStoryInput = z.object({
  // Client-minted, so the caller can render the row before this returns.
  id: newStoryId.optional(),
  title: z.string().optional(),
})

export const storyMetaPatch = z.object({
  title: z.string().trim().min(1, "Title can't be empty.").optional(),
  description: z.string().optional(),
  genre: z.string().optional(),
  memory: z.string().optional(),
  authorsNote: z.string().optional(),
  /** "" clears the override back to the built-in prompt. */
  systemPrompt: z.string().nullable().optional(),
  /** Whether new summary versions are written. See the schema's column note. */
  summarize: z.boolean().optional(),
})

export const updateStoryMetaInput = z.object({
  id: existingStoryId,
  patch: storyMetaPatch,
})

export const storyTintPatch = z.object({
  /** Degrees, or null to clear the tint back to the neutral palette. */
  hue: anyNumber("Invalid tint hue.").nullable(),
  /** 0..1. Ignored when hue is null. */
  strength: anyNumber("Invalid tint strength.").optional(),
  /** Left undefined leaves the flag alone. */
  auto: z.boolean().optional(),
})

export const updateStoryTintInput = z.object({
  id: existingStoryId,
  patch: storyTintPatch,
})

export const setStoryTintAutoInput = z.object({
  id: existingStoryId,
  auto: z.boolean(),
})

/** Keys are ordered as the old action checked them; see parseInput. */
export const duplicateStoryInput = z.object({
  copyId: newStoryId.optional(),
  id: existingStoryId,
})

export const deleteStoryInput = z.object({ id: existingStoryId })

export const generationSettingsPatch = z.object({
  modelId: z.string().optional(),
  thinking: z.enum(thinkingLevels).optional(),
  providerTag: z.string().nullable().optional(),
  zdr: z.boolean().optional(),
  temperature: anyNumber("Invalid temperature.").optional(),
  topP: anyNumber("Invalid top-p.").optional(),
  contextWindow: anyNumber("Unsupported context window.")
    .refine(isContextWindow, "Unsupported context window.")
    .optional(),
  loreBudget: anyNumber("Invalid lore budget.").optional(),
  frequencyPenalty: anyNumber("Invalid frequency penalty.").optional(),
  presencePenalty: anyNumber("Invalid presence penalty.").optional(),
})

export const updateGenerationSettingsInput = z.object({
  id: existingStoryId,
  patch: generationSettingsPatch,
})

export const setStoryImageModelInput = z.object({
  id: existingStoryId,
  /** A concrete choice, or null to follow the app's default image model. */
  imageModelId: z.string({ error: "Invalid image model." }).nullable(),
})

export const storyRecord = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  genre: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  wordCount: z.number(),
  tintHue: z.number().nullable(),
  tintStrength: z.number(),
  tintAuto: z.boolean(),
})

export const storySummary = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  genre: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  wordCount: z.number().optional(),
  tintHue: z.number().nullable(),
  tintStrength: z.number(),
})

export const storyPageOutput = z.object({
  stories: z.array(storySummary),
  hasMore: z.boolean(),
})

export const storyCreatedOutput = z.object({
  id: z.string(),
  record: storyRecord,
})

export const storyWriteOutput = z.object({ record: storyRecord })

/** Writes whose action never returned the row. */
export const storyEmptyOutput = z.null()

export type LoadStoryPageInput = z.input<typeof loadStoryPageInput>
export type CreateStoryInput = z.input<typeof createStoryInput>
export type UpdateStoryMetaInput = z.input<typeof updateStoryMetaInput>
export type UpdateStoryTintInput = z.input<typeof updateStoryTintInput>
export type SetStoryTintAutoInput = z.input<typeof setStoryTintAutoInput>
export type DuplicateStoryInput = z.input<typeof duplicateStoryInput>
export type DeleteStoryInput = z.input<typeof deleteStoryInput>
export type UpdateGenerationSettingsInput = z.input<
  typeof updateGenerationSettingsInput
>
export type SetStoryImageModelInput = z.input<typeof setStoryImageModelInput>
