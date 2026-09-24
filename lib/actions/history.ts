"use server"

import { NO_ORIGIN } from "@/lib/services/context"
import * as history from "@/lib/services/history"
import type { ActionResult } from "@/lib/types"

// No origin to pass: a history walk publishes a bare change event, which has
// no field to carry one.

export async function undoStoryOp(
  storyId: string
): Promise<ActionResult<{ summary: string } | null>> {
  return history.undoStoryOp({ storyId }, NO_ORIGIN)
}

export async function redoStoryOp(
  storyId: string
): Promise<ActionResult<{ summary: string } | null>> {
  return history.redoStoryOp({ storyId }, NO_ORIGIN)
}

export async function selectVariantByOffset(
  storyId: string,
  entryId: string,
  offset: number
): Promise<ActionResult<{ summary: string } | null>> {
  return history.selectVariantByOffset({ storyId, entryId, offset }, NO_ORIGIN)
}
