"use server"

import { revalidatePath } from "next/cache"

import { getStory, listLorebookEntries } from "@/lib/db/queries"
import { composeContext } from "@/lib/generation/context"
import { resolveOpenRouterKey } from "@/lib/generation/key"
import { listModels } from "@/lib/generation/models"
import type { ProviderKind } from "@/lib/generation/provider"
import type { ComposedContext } from "@/lib/generation/types"
import {
  clampContextWindow,
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
 */
export async function prepareGeneration(
  storyId: string,
  opts: { kind?: ActionKind; userText?: string; variant?: number }
): Promise<
  ActionResult<{
    context: ComposedContext
    settings: GenerationSettings
    /** Decided here, where the key is visible: real provider iff a key exists. */
    providerKind: ProviderKind
  }>
> {
  // A turn needs both halves: `kind` alone has nothing to translate, and
  // `userText` alone cannot be translated without knowing which voice it is.
  // Either way the honest reading is Continue, so nothing is appended.
  if (opts.kind !== undefined && opts.userText !== undefined) {
    const appended = await appendActionEntry(storyId, opts.kind, opts.userText)
    if (!appended.ok) return appended
  }

  const [story, lorebookEntries, models] = await Promise.all([
    getStory(storyId),
    listLorebookEntries(storyId),
    // Cached for an hour in-process, so this is nearly free — see models.ts.
    listModels(),
  ])
  const openRouterKey = resolveOpenRouterKey()

  if (!story) return { ok: false, error: "Story not found." }

  // The stored window can exceed what the selected model accepts: the catalog
  // is live, so a row written against a bigger model (or against MOCK_MODELS,
  // before a key was configured) outlives the model that justified it. The
  // inspector clamps for display and writes the fix-up back, but this is the
  // path that actually builds the request — it clamps for itself rather than
  // trusting the row. The clamped value rides out in `settings` too, so callers
  // never see a window the assembled context wasn't built against.
  const settings: GenerationSettings = {
    ...story.settings,
    contextWindow: clampContextWindow(
      story.settings.contextWindow,
      models.find((m) => m.id === story.settings.modelId)?.contextLength ?? 0
    ),
  }

  const context = composeContext({
    story,
    lorebookEntries,
    variant: opts.variant ?? 0,
    contextWindow: settings.contextWindow,
  })

  revalidatePath("/", "layout")
  return {
    ok: true,
    data: {
      context,
      settings,
      providerKind: openRouterKey !== null ? "openrouter" : "mock",
    },
  }
}
