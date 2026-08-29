"use server"

import { and, eq, isNull } from "drizzle-orm"

import { commitChange } from "@/lib/actions/commit"
import { getDb } from "@/lib/db/client"
import { stopImageRun } from "@/lib/images/live"
import { storyImages } from "@/lib/db/schema"
import type { ActionResult } from "@/lib/types"

/**
 * Aborts a story's live image run — the picture-shaped stopGeneration. Any
 * device may call it; a no-op when nothing is drawing. `runId` names the run
 * the caller was watching, so a stale device's Stop cannot kill a later draw.
 * The loop sees the signal and lands in the same settle path a finished draw
 * does, so every subscriber gets the aborted end frame.
 */
export async function stopIllustration(
  storyId: string,
  runId: string | null
): Promise<ActionResult> {
  stopImageRun(storyId, runId)
  return { ok: true, data: null }
}

/**
 * Soft-deletes an illustration — the whole slot, every take.
 *
 * The slot rather than the row, because a picture's takes are alternatives to
 * ONE picture: deleting the visible one and silently promoting a sibling would
 * mean the writer has to press delete once per retry they ever made, which is
 * not what "delete this illustration" says.
 *
 * Reversible by `restoreIllustration`, which the delete toast offers. NOT in
 * the undo journal in this slice — see the note there.
 */
export async function deleteIllustration(
  storyId: string,
  imageGroupId: string
): Promise<ActionResult> {
  const db = await getDb()
  await db
    .update(storyImages)
    .set({ deletedAt: new Date().toISOString() })
    .where(
      and(
        eq(storyImages.storyId, storyId),
        eq(storyImages.imageGroupId, imageGroupId),
        isNull(storyImages.deletedAt)
      )
    )
  commitChange(storyId)
  return { ok: true, data: null }
}

/** Undoes a `deleteIllustration`. The bytes were never touched, so this is one UPDATE. */
export async function restoreIllustration(
  storyId: string,
  imageGroupId: string
): Promise<ActionResult> {
  const db = await getDb()
  await db
    .update(storyImages)
    .set({ deletedAt: null })
    .where(
      and(
        eq(storyImages.storyId, storyId),
        eq(storyImages.imageGroupId, imageGroupId)
      )
    )
  commitChange(storyId)
  return { ok: true, data: null }
}

/**
 * Makes a named take of a slot the active one — the gallery's promote.
 *
 * By id where the canvas's selectImageByOffset takes an offset, and the
 * difference is which side can name the target. The canvas holds only the
 * active take, so only the server knows what "next" is; the gallery lightbox
 * holds the whole slot and is pointing at one thumbnail, so an offset would
 * mean recomputing on the client what it already has in hand.
 *
 * A no-op for a take that is already active, or one that is not a live member
 * of this slot — a stale click from a device whose wall predates a delete.
 */
export async function selectImageById(
  storyId: string,
  imageGroupId: string,
  imageId: string
): Promise<ActionResult> {
  const db = await getDb()
  const moved = await db.transaction(async (tx) => {
    const takes = await tx
      .select({ id: storyImages.id, isActive: storyImages.isActive })
      .from(storyImages)
      .where(
        and(
          eq(storyImages.storyId, storyId),
          eq(storyImages.imageGroupId, imageGroupId),
          isNull(storyImages.deletedAt)
        )
      )
    const target = takes.find((take) => take.id === imageId)
    if (!target || target.isActive) return false

    // Clears every take rather than just the one that was active: the invariant
    // this restores is "exactly one active per slot", and a slot that had
    // somehow acquired two would otherwise keep one of them forever.
    await tx
      .update(storyImages)
      .set({ isActive: false })
      .where(
        and(
          eq(storyImages.storyId, storyId),
          eq(storyImages.imageGroupId, imageGroupId)
        )
      )
    await tx
      .update(storyImages)
      .set({ isActive: true })
      .where(eq(storyImages.id, target.id))
    return true
  })

  if (moved) commitChange(storyId)
  return { ok: true, data: null }
}

/**
 * Steps to the neighbouring take of an illustration's slot.
 *
 * Takes an OFFSET and not a sibling id, mirroring selectVariantByOffset: the
 * canvas only ever holds the active take, so the server is the only side that
 * can name the neighbour.
 */
export async function selectImageByOffset(
  storyId: string,
  imageGroupId: string,
  offset: number
): Promise<ActionResult> {
  if (offset !== 1 && offset !== -1) {
    return { ok: false, error: "Can only step one take at a time." }
  }

  const db = await getDb()
  const moved = await db.transaction(async (tx) => {
    const takes = await tx
      .select({ id: storyImages.id, isActive: storyImages.isActive })
      .from(storyImages)
      .where(
        and(
          eq(storyImages.storyId, storyId),
          eq(storyImages.imageGroupId, imageGroupId),
          isNull(storyImages.deletedAt)
        )
      )
      .orderBy(storyImages.imageIndex)

    const current = takes.findIndex((take) => take.isActive)
    const target = current + offset
    // Clamped rather than wrapped, matching the arrows: they disable at the
    // ends, so an out-of-range offset is a stale click and doing nothing is the
    // right answer to it.
    if (current === -1 || target < 0 || target >= takes.length) return false

    await tx
      .update(storyImages)
      .set({ isActive: false })
      .where(eq(storyImages.id, takes[current].id))
    await tx
      .update(storyImages)
      .set({ isActive: true })
      .where(eq(storyImages.id, takes[target].id))
    return true
  })

  if (moved) commitChange(storyId)
  return { ok: true, data: null }
}
