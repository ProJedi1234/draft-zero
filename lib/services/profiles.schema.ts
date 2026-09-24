// lib/services/profiles.schema.ts — The model profiles' request and response
// contract. Isomorphic: no server imports, so a contract package can lift it.
import { z } from "zod"

import { entityId } from "@/lib/services/schema"
import {
  isContextWindow,
  REASONING_EFFORTS,
  type ThinkingLevel,
} from "@/lib/types"

const NOT_FOUND = "Profile not found."

// An id that cannot be a primary key names no row, so it reads as the lookup
// that would have missed.
const profileId = entityId(NOT_FOUND)
const storyId = entityId("Story not found.")

const profileName = z
  .string({ error: "Name the profile." })
  .trim()
  .min(1, "Name the profile.")

const thinkingLevels = ["off", ...REASONING_EFFORTS] as [
  ThinkingLevel,
  ...ThinkingLevel[],
]

const slider = z.number().nullable()

/**
 * A profile's settings, keyed in the order the old validateSettings checked
 * them. providerTag is deliberately unchecked, exactly as on a story: the
 * endpoint list is a live remote catalog and a stale tag is dropped at send
 * time by providerParam(), not rejected on the way in.
 *
 * A null contextWindow passes: it is not an off-ladder window but the absence
 * of one, and the ladder is enforced on the global default instead.
 */
export const profileSettings = z.object({
  // Checked trimmed but stored as sent, as the old action did.
  modelId: z
    .string({ error: "Pick a model." })
    .refine((value) => value.trim() !== "", "Pick a model."),
  thinking: z.enum(thinkingLevels, { error: "Unknown thinking level." }),
  contextWindow: z
    .number({ error: "Unsupported context window." })
    .nullable()
    .refine(
      (value) => value === null || isContextWindow(value),
      "Unsupported context window."
    ),
  providerTag: z.string().nullable(),
  zdr: z.boolean(),
  temperature: slider,
  topP: slider,
  loreBudget: slider,
  frequencyPenalty: slider,
  presencePenalty: slider,
})

export const createProfileInput = z.object({
  name: profileName,
  settings: profileSettings,
})

export const updateProfileInput = z.object({
  id: profileId,
  patch: z.object({
    name: profileName.optional(),
    settings: profileSettings.partial().optional(),
  }),
})

const STALE_LIST = "The profile list changed. Try again."

// A malformed list reads as the stale one it effectively is.
export const reorderProfilesInput = z.object({
  orderedIds: z.array(z.string({ error: STALE_LIST }), { error: STALE_LIST }),
})

export const setDefaultProfileInput = z.object({ id: profileId })

export const deleteProfileInput = z.object({ id: profileId })

/** Profile before story: the old action looked the profile up first. */
export const setStoryProfileInput = z.object({
  profileId: profileId.nullable(),
  storyId,
})

/**
 * The name is only typed here, not trimmed or checked: the old action read the
 * story first and judged the name afterwards, alongside the settings it copied.
 */
export const saveStoryAsProfileInput = z.object({
  storyId,
  name: z.string({ error: "Name the profile." }),
})

export const profileIdOutput = z.object({ id: z.string() })

export const profileWriteOutput = z.null()

export type CreateProfileInput = z.input<typeof createProfileInput>
export type UpdateProfileInput = z.input<typeof updateProfileInput>
export type ReorderProfilesInput = z.input<typeof reorderProfilesInput>
export type SetDefaultProfileInput = z.input<typeof setDefaultProfileInput>
export type DeleteProfileInput = z.input<typeof deleteProfileInput>
export type SetStoryProfileInput = z.input<typeof setStoryProfileInput>
export type SaveStoryAsProfileInput = z.input<typeof saveStoryAsProfileInput>
