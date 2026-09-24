// lib/services/images.ts — Illustration writes, callable from a server action,
// a route handler or an MCP tool alike. Starting a draw lives in
// app/api/image; everything here acts on a run or on takes already persisted.
import "server-only"

import { and, eq, isNull } from "drizzle-orm"

import { getDb } from "@/lib/db/client"
import { storyImages } from "@/lib/db/schema"
import { stopImageRun } from "@/lib/images/live"
import { commitChange } from "@/lib/services/commit"
import type { Service } from "@/lib/services/context"
import {
  illustrationSlotInput,
  selectImageByIdInput,
  selectImageByOffsetInput,
  stopIllustrationInput,
  type IllustrationSlotInput,
  type SelectImageByIdInput,
  type SelectImageByOffsetInput,
  type StopIllustrationInput,
} from "@/lib/services/images.schema"
import { ok, parseInput } from "@/lib/services/result"

/**
 * Aborts a story's live image run — the picture-shaped stopGeneration. Any
 * device may call it; a no-op when nothing is drawing. `runId` names the run
 * the caller was watching, so a stale device's Stop cannot kill a later draw.
 * The loop sees the signal and lands in the same settle path a finished draw
 * does, so every subscriber gets the aborted end frame.
 */
export const stopIllustration: Service<StopIllustrationInput, null> = async (
  raw
) => {
  const parsed = parseInput(stopIllustrationInput, raw)
  if (!parsed.ok) return parsed
  stopImageRun(parsed.data.storyId, parsed.data.runId)
  return ok(null)
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
export const deleteIllustration: Service<IllustrationSlotInput, null> = async (
  raw
) => {
  const parsed = parseInput(illustrationSlotInput, raw)
  if (!parsed.ok) return parsed
  const { storyId, imageGroupId } = parsed.data

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
  return ok(null)
}

/** Undoes a `deleteIllustration`. The bytes were never touched, so this is one UPDATE. */
export const restoreIllustration: Service<IllustrationSlotInput, null> = async (
  raw
) => {
  const parsed = parseInput(illustrationSlotInput, raw)
  if (!parsed.ok) return parsed
  const { storyId, imageGroupId } = parsed.data

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
  return ok(null)
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
export const selectImageById: Service<SelectImageByIdInput, null> = async (
  raw
) => {
  const parsed = parseInput(selectImageByIdInput, raw)
  if (!parsed.ok) return parsed
  const { storyId, imageGroupId, imageId } = parsed.data

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
  return ok(null)
}

/**
 * Steps to the neighbouring take of an illustration's slot.
 *
 * Takes an OFFSET and not a sibling id, mirroring selectVariantByOffset: the
 * canvas only ever holds the active take, so the server is the only side that
 * can name the neighbour.
 */
export const selectImageByOffset: Service<
  SelectImageByOffsetInput,
  null
> = async (raw) => {
  const parsed = parseInput(selectImageByOffsetInput, raw)
  if (!parsed.ok) return parsed
  const { storyId, imageGroupId, offset } = parsed.data

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
  return ok(null)
}
