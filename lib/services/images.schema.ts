// lib/services/images.schema.ts — The illustration writes' request and
// response contract. Isomorphic: no server imports, so a contract package can
// lift it.
import { z } from "zod"

import { entityId } from "@/lib/services/schema"

const storyId = entityId("Invalid story id.")
const imageGroupId = entityId("Invalid illustration id.")
const imageId = entityId("Invalid image id.")

const ONE_STEP = "Can only step one take at a time."

export const stopIllustrationInput = z.object({
  storyId,
  // Null aborts whatever is drawing; see stopImageRun.
  runId: z.string().nullable().default(null),
})

/** Names a slot, which is every take of one illustration. */
export const illustrationSlotInput = z.object({ storyId, imageGroupId })

export const selectImageByIdInput = z.object({
  storyId,
  imageGroupId,
  imageId,
})

/** Offset first: it was the only thing the old action checked. */
export const selectImageByOffsetInput = z.object({
  offset: z
    .number({ error: ONE_STEP })
    .refine((n) => n === 1 || n === -1, ONE_STEP),
  storyId,
  imageGroupId,
})

/** Every illustration write answers with no data; the bus carries the change. */
export const illustrationWriteOutput = z.null()

export type StopIllustrationInput = z.input<typeof stopIllustrationInput>
export type IllustrationSlotInput = z.input<typeof illustrationSlotInput>
export type SelectImageByIdInput = z.input<typeof selectImageByIdInput>
export type SelectImageByOffsetInput = z.input<typeof selectImageByOffsetInput>
