"use server"

import { revalidatePath } from "next/cache"

import { getStory, listLorebookEntries } from "@/lib/db/queries"
import { composeContext } from "@/lib/generation/context"
import { listModelEndpoints } from "@/lib/generation/endpoints"
import { resolveOpenRouterKey } from "@/lib/generation/key"
import { listModels } from "@/lib/generation/models"
import type { ProviderKind } from "@/lib/generation/provider"
import type { ComposedContext } from "@/lib/generation/types"
import {
  clampContextWindow,
  endpointForTag,
  type ActionKind,
  type ActionResult,
  type GenerationSettings,
} from "@/lib/types"

import { appendActionEntry } from "./entries"

/**
 * One round-trip that prepares a generation:
 * - `kind` + `userText`: the writer took a turn — it is translated and
 *   persisted first, so the context is composed against a story that already
 *   ends with it
 * - neither: plain Continue, appends nothing
 * Then composes context from fresh DB state and returns it with the story's settings.
 * `variant` feeds the deterministic seed so Retry produces a different continuation.
 * `turnId` ties the writer's row and the passage it produces into one undo step:
 * the client mints it before the round-trip and hands the same value to
 * appendGeneratedEntry, and the journal extends the op it already wrote here
 * rather than recording a second one.
 * `variantGroupId` marks this as a Retry, and the slot it names is left OUT of
 * the composed context — see the filter below.
 */
export async function prepareGeneration(
  storyId: string,
  opts: {
    kind?: ActionKind
    userText?: string
    variant?: number
    turnId?: string
    variantGroupId?: string
  }
): Promise<
  ActionResult<{
    context: ComposedContext
    settings: GenerationSettings
    /** Decided here, where the key is visible: real provider iff a key exists. */
    providerKind: ProviderKind
    /**
     * The row this call wrote for the writer's turn, or null for a Continue.
     * The client holds its optimistic echo until an entry with this id shows up
     * in the revalidated story — that is the only signal that tells the two
     * apart, so the swap can happen in the commit that delivers the real row
     * instead of a commit or two earlier (a gap) or later (a duplicate).
     */
    userEntryId: string | null
  }>
> {
  // A turn needs both halves: `kind` alone has nothing to translate, and
  // `userText` alone cannot be translated without knowing which voice it is.
  // Either way the honest reading is Continue, so nothing is appended.
  let userEntryId: string | null = null
  if (opts.kind !== undefined && opts.userText !== undefined) {
    const appended = await appendActionEntry(
      storyId,
      opts.kind,
      opts.userText,
      opts.turnId ?? null
    )
    if (!appended.ok) return appended
    userEntryId = appended.data.entry.id
  }

  const [story, lorebookEntries, models] = await Promise.all([
    getStory(storyId),
    listLorebookEntries(storyId),
    // Cached for an hour in-process, so this is nearly free — see models.ts.
    listModels(),
  ])
  // Only fetched when the story pins a provider, and cached five minutes per
  // model when it does — see endpoints.ts.
  const endpoints =
    story?.settings.providerTag == null
      ? []
      : await listModelEndpoints(story.settings.modelId)
  const openRouterKey = resolveOpenRouterKey()

  if (!story) return { ok: false, error: "Story not found." }

  // The stored window can exceed what the selected model accepts: the catalog
  // is live, so a row written against a bigger model (or against MOCK_MODELS,
  // before a key was configured) outlives the model that justified it. The
  // inspector clamps for display and writes the fix-up back, but this is the
  // path that actually builds the request — it clamps for itself rather than
  // trusting the row. The clamped value rides out in `settings` too, so callers
  // never see a window the assembled context wasn't built against.
  // A pinned endpoint's window wins over the model's: a third-party host often
  // serves a shorter one, and it is the host that will reject the request.
  const settings: GenerationSettings = {
    ...story.settings,
    contextWindow: clampContextWindow(
      story.settings.contextWindow,
      endpointForTag(endpoints, story.settings.providerTag)?.contextLength ??
        models.find((m) => m.id === story.settings.modelId)?.contextLength ??
        0
    ),
  }

  // A Retry is an ALTERNATIVE to a passage, not a continuation of it, so the
  // slot being retried is dropped before the context is composed. Leave it in
  // and the model is handed a story that ends with the very take it is meant to
  // replace, and dutifully writes what comes next — which then gets stored as a
  // second take of that same slot, so flipping between takes shows passage N
  // and passage N+1 instead of two versions of passage N.
  //
  // Filtering by slot rather than by row id covers the inactive takes too: they
  // are not in `story.entries` today, but the rule "this slot is not part of
  // the story we are asking about" is the one that stays true if that changes.
  // The old take is still on disk and untouched — this only decides what the
  // model is shown. Note the seed moves with `entries.length`, and `variant` is
  // bumped per retry on top of that, so successive takes stay distinct.
  const storyForContext =
    opts.variantGroupId === undefined
      ? story
      : {
          ...story,
          entries: story.entries.filter(
            (entry) => entry.variantGroupId !== opts.variantGroupId
          ),
        }

  const context = composeContext({
    story: storyForContext,
    lorebookEntries,
    variant: opts.variant ?? 0,
    contextWindow: settings.contextWindow,
  })

  // No revalidation here on purpose: this response is what the writer is
  // waiting on before a single token appears, and re-rendering the whole layout
  // to deliver a row the canvas is already echoing buys nothing but latency.
  // The client calls syncStoryTree (or persists the passage, which revalidates)
  // once the turn settles — including when it fails.
  return {
    ok: true,
    data: {
      context,
      settings,
      providerKind: openRouterKey !== null ? "openrouter" : "mock",
      userEntryId,
    },
  }
}

/**
 * Refreshes the story tree without writing anything.
 *
 * The client needs this because prepareGeneration deliberately doesn't
 * revalidate: on the paths where the turn ends without a generated passage
 * (stopped before the first token, provider error, context composition failure)
 * the writer's row is on disk and nothing else would ever fetch it, so the
 * optimistic echo would be all that's holding the passage on screen.
 */
export async function syncStoryTree(): Promise<void> {
  revalidatePath("/", "layout")
}
