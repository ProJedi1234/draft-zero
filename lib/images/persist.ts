// lib/images/persist.ts — Writes a finished illustration down. Server-only.
//
// Moved out of lib/actions/images.ts when image runs became server-owned: the
// run loop is a detached task with no request behind it, and commitChange's
// revalidatePath half needs a request to act on. This module does the durable
// work and says nothing; announcing the write is the caller's job — the run
// loop touches the bus directly, exactly as the text side's finishRun does.
import "server-only"

import { and, eq, isNull, max } from "drizzle-orm"

import { getDb } from "@/lib/db/client"
import { nextStoryPosition } from "@/lib/db/entry-writes"
import { toImageTake, toStoryImage } from "@/lib/db/mappers"
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
 * Persists a finished illustration — the tail of the image run loop.
 *
 * `imageGroupId` names an existing slot, which makes this a RETRY: the new take
 * lands beside the old one at the next index, takes over as active, and INHERITS
 * the slot's position — a retry is another draw of the same beat, not a new one
 * appended to the end of the story. Omitted, the image opens a slot of its own
 * at the end of the manuscript.
 */
export async function persistIllustration(input: {
  storyId: string
  imageGroupId?: string
  /** The whole text sent to the provider, style sentence included. */
  prompt: string
  /** The writer's brief, or null when there was none (a verbatim send). */
  sourcePrompt: string | null
  /** Lorebook entries fed to the develop call; empty when none were. */
  promptLoreIds: string[]
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
        sourcePrompt: input.sourcePrompt,
        // NULL rather than "[]" for the empty case: absent lore and a draw that
        // never consulted the lorebook are the same fact, and a stored empty
        // array would look like a develop call that matched nothing.
        promptLoreIdsJson:
          input.promptLoreIds.length > 0
            ? JSON.stringify(input.promptLoreIds)
            : null,
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

  // count is the honest 1 for a fresh slot; on a retry the refreshed story tree
  // carries the real figure a beat later. Overstating it here would flash a
  // switcher pointing at a take that does not exist — and `takes` understates
  // for the same reason, holding only the draw that just landed until the tree
  // arrives with its siblings.
  return {
    ok: true,
    data: toStoryImage(row, {
      index: row.imageIndex,
      count: row.imageIndex + 1,
      takes: [toImageTake(row)],
    }),
  }
}
