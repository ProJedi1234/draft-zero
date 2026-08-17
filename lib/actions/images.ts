"use server"

import { and, eq, isNull, max } from "drizzle-orm"

import { commitChange } from "@/lib/actions/commit"
import { getDb } from "@/lib/db/client"
import { nextStoryPosition } from "@/lib/db/entry-writes"
import { toStoryImage } from "@/lib/db/mappers"
import { generationCalls, storyImages } from "@/lib/db/schema"
import { resolveImageModelId } from "@/lib/images/models"
import { writeImage } from "@/lib/images/store"
import {
  IMAGE_ASPECT_RATIOS,
  type ActionResult,
  type ImageAspectRatio,
  type StoryImage,
} from "@/lib/types"

/**
 * Persists a finished illustration.
 *
 * The BYTES arrive from the client, which is true only of the offline mock and
 * is the one place this slice diverges from where it is going: MockImageProvider
 * is isomorphic by design (same contract as MockGenerationProvider), so the
 * browser runs it, renders its partials directly, and hands the settled image
 * here to be written down. A real provider inverts that — the server calls
 * OpenRouter, streams partials out over the existing SSE plumbing, and this
 * action collapses into the tail of a run loop. Everything below that line
 * (the row, the slot arithmetic, the blob store) is the shape it keeps.
 *
 * `imageGroupId` names an existing slot, which makes this a RETRY: the new take
 * lands beside the old one at the next index, takes over as active, and INHERITS
 * the slot's position — a retry is another draw of the same beat, not a new one
 * appended to the end of the story. Omitted, the image opens a slot of its own
 * at the end of the manuscript.
 */
export async function createIllustration(input: {
  storyId: string
  imageGroupId?: string
  prompt: string
  derivedPrompt: string | null
  /** The story's chosen image model, or null to follow the catalog's first. */
  modelId: string | null
  aspectRatio: ImageAspectRatio
  seed: number
  mediaType: string
  /** Base64 of the image, straight off the provider's completed event. */
  b64: string
  /** The ledger row this picture came out of, stamped inside the same commit. */
  callId?: string | null
}): Promise<ActionResult<StoryImage>> {
  const prompt = input.prompt.trim()
  if (prompt === "") {
    return { ok: false, error: "An illustration needs a prompt." }
  }
  // Validated rather than trusted: the ratio decides the box the manuscript
  // reserves, and an unrecognised one would render as a zero-height figure.
  if (!IMAGE_ASPECT_RATIOS.includes(input.aspectRatio)) {
    return { ok: false, error: "Unsupported aspect ratio." }
  }

  const db = await getDb()
  const id = crypto.randomUUID()
  // Resolved here rather than in the browser: the catalog is server-side and
  // cached, and the row must record a concrete id — "whatever was first that
  // day" is not provenance.
  const modelId = await resolveImageModelId(input.modelId)

  // The file is written BEFORE the row, and deliberately so: a row pointing at
  // bytes that do not exist renders as a broken picture in the manuscript,
  // while bytes with no row are invisible garbage a cleanup can sweep. Only one
  // of those two failure modes is visible to the writer.
  await writeImage(id, input.mediaType, input.b64)

  const row = await db.transaction(async (tx) => {
    const groupId = input.imageGroupId ?? id

    // MAX + 1 over the slot's real takes, read inside the transaction. A
    // client-side counter cannot see the takes another device already made, and
    // two "second" takes sharing an index would make the switcher's readout
    // disagree with what the arrows do.
    const slot = input.imageGroupId
      ? await tx
          .select({
            highest: max(storyImages.imageIndex),
            position: max(storyImages.position),
          })
          .from(storyImages)
          .where(
            and(
              eq(storyImages.storyId, input.storyId),
              eq(storyImages.imageGroupId, groupId)
            )
          )
          .then((rows) => rows[0])
      : undefined

    const nextIndex = (slot?.highest ?? -1) + 1
    // A retry keeps the beat it is redrawing; a first draw appends. Allocated
    // from the counter story_entries shares, so a picture and a passage can
    // never claim the same place in the manuscript.
    const position =
      slot?.position ?? (await nextStoryPosition(tx, input.storyId))

    // The new take becomes the active one, so its siblings stand down first —
    // the partial unique index on the anchor permits exactly one live active
    // row per passage slot, and this insert would otherwise collide with the
    // take it is meant to replace.
    if (input.imageGroupId) {
      await tx
        .update(storyImages)
        .set({ isActive: false })
        .where(
          and(
            eq(storyImages.storyId, input.storyId),
            eq(storyImages.imageGroupId, groupId)
          )
        )
    }

    const inserted = await tx
      .insert(storyImages)
      .values({
        id,
        storyId: input.storyId,
        position,
        imageGroupId: groupId,
        imageIndex: nextIndex,
        isActive: true,
        prompt,
        derivedPrompt: input.derivedPrompt,
        modelId,
        aspectRatio: input.aspectRatio,
        seed: input.seed,
        mediaType: input.mediaType,
        createdAt: new Date().toISOString(),
      })
      .returning()

    // AFTER the insert, not before: story_image_id is a real foreign key, so
    // stamping it at a row that does not exist yet aborts the transaction.
    // Still inside it, so a take and its price are joined in one commit. The
    // IS NULL guard means a call can only be claimed once.
    if (input.callId) {
      await tx
        .update(generationCalls)
        .set({ storyImageId: id, origImageGroupId: groupId })
        .where(
          and(
            eq(generationCalls.id, input.callId),
            isNull(generationCalls.storyImageId)
          )
        )
    }

    return inserted[0]
  })

  commitChange(input.storyId)
  // count is the honest 1 for a fresh slot; on a retry the refreshed story tree
  // carries the real figure a beat later. Overstating it here would flash a
  // switcher pointing at a take that does not exist.
  return {
    ok: true,
    data: toStoryImage(row, { index: row.imageIndex, count: row.imageIndex + 1 }),
  }
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
