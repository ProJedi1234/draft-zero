"use server"

import { getStoryFull, listLorebookEntries } from "@/lib/db/queries"
import { composeContext } from "@/lib/generation/context"
import { listModelEndpoints } from "@/lib/generation/endpoints"
import { listModels } from "@/lib/generation/models"
import type { ComposedContext } from "@/lib/generation/types"
import {
  clampContextWindow,
  endpointForTag,
  type ActionResult,
} from "@/lib/types"

/** A passage's context, composed on demand. */
export interface EntryContext {
  context: ComposedContext
  /** The budget it was composed against — clamped the way a real request is. */
  contextWindow: number
  /** The model that wrote the passage. Null when the row never recorded one. */
  modelId: string | null
}

/**
 * What this passage was shown, composed from the story truncated to just
 * before it.
 *
 * Deliberately NOT read from a stored record of the original request. Keeping
 * one would be exact, and it would also be blank for every passage written
 * before it existed — which is most of any real manuscript. This composes the
 * same way a Retry of this passage would: the manuscript up to it, and the
 * lorebook, memory, author's note and window AS THEY STAND. That makes it an
 * answer about the present ("what would this passage be sent now"), which is
 * the actionable question, and the viewer says so rather than presenting it as
 * a record.
 *
 * The prose half is faithful whatever has changed since — every passage is on
 * disk in order, so the story the model saw is reconstructible exactly. What
 * drifts is everything on the mutable story row: edit a lore entry or move the
 * window and this answer moves with it, by design.
 *
 * Truncating by INDEX rather than by id-matching covers a retried passage for
 * free: story.entries holds one active take per slot in position order, so
 * everything before the take is everything before its slot — which is the same
 * filter startGeneration applies when it composes a retry.
 *
 * `ok` with null data is the ordinary answer for a passage that is no longer in
 * the manuscript (deleted, or an inactive take), not a failure.
 */
export async function loadEntryContext(
  storyId: string,
  entryId: string
): Promise<ActionResult<EntryContext | null>> {
  try {
    const [story, lorebookEntries, models] = await Promise.all([
      // Full manuscript, deliberately: this viewer answers "what was this
      // passage told", and the passage may sit anywhere in the story.
      getStoryFull(storyId),
      listLorebookEntries(storyId),
      // Cached for an hour in-process, so this is nearly free — see models.ts.
      listModels(),
    ])
    if (!story) return { ok: false, error: "Story not found." }

    const index = story.entries.findIndex((entry) => entry.id === entryId)
    if (index === -1) return { ok: true, data: null }

    // The same clamp startGeneration applies, for the same reason: the stored
    // window can outlive the model that justified it, and a viewer composed
    // against a budget no request would use is worse than no viewer.
    const endpoints =
      story.settings.providerTag == null
        ? []
        : await listModelEndpoints(story.settings.modelId)
    const contextWindow = clampContextWindow(
      story.settings.contextWindow,
      endpointForTag(endpoints, story.settings.providerTag)?.contextLength ??
        models.find((m) => m.id === story.settings.modelId)?.contextLength ??
        0
    )

    return {
      ok: true,
      data: {
        context: composeContext({
          story: { ...story, entries: story.entries.slice(0, index) },
          lorebookEntries,
          contextWindow,
        }),
        contextWindow,
        // Never today's model as a stand-in: a guess here is indistinguishable
        // from a recorded fact, which is the one thing provenance may not be.
        modelId: story.entries[index].generation?.modelId ?? null,
      },
    }
  } catch (err) {
    console.error("[context] failed to compose a passage's context", err)
    return {
      ok: false,
      error: "Couldn't work out the context for this passage.",
    }
  }
}
