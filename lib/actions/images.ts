"use server"

import * as images from "@/lib/services/images"
import { NO_ORIGIN } from "@/lib/services/context"
import type { ActionResult } from "@/lib/types"

// None of these writes publish an entity event, so there is no origin to
// thread: the bus hears a story-scoped change, which every device refetches.

export async function stopIllustration(
  storyId: string,
  runId: string | null
): Promise<ActionResult> {
  return images.stopIllustration({ storyId, runId }, NO_ORIGIN)
}

export async function deleteIllustration(
  storyId: string,
  imageGroupId: string
): Promise<ActionResult> {
  return images.deleteIllustration({ storyId, imageGroupId }, NO_ORIGIN)
}

export async function restoreIllustration(
  storyId: string,
  imageGroupId: string
): Promise<ActionResult> {
  return images.restoreIllustration({ storyId, imageGroupId }, NO_ORIGIN)
}

export async function selectImageById(
  storyId: string,
  imageGroupId: string,
  imageId: string
): Promise<ActionResult> {
  return images.selectImageById({ storyId, imageGroupId, imageId }, NO_ORIGIN)
}

export async function selectImageByOffset(
  storyId: string,
  imageGroupId: string,
  offset: number
): Promise<ActionResult> {
  return images.selectImageByOffset(
    { storyId, imageGroupId, offset },
    NO_ORIGIN
  )
}
