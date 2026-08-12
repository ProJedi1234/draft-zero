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
  type ActionResult,
  type GenerationSettings,
} from "@/lib/types"

import { appendUserEntry } from "./entries"

/**
 * One round-trip that prepares a generation:
 * - mode "story" with userText: appends the user passage first
 * - mode "story" without userText: plain Continue, appends nothing
 * - mode "instruction": userText required, NOT persisted — passed into context.instruction
 * Then composes context from fresh DB state and returns it with the story's settings.
 * `variant` feeds the deterministic seed so Retry produces a different continuation.
 */
export async function prepareGeneration(
  storyId: string,
  opts: { mode: "story" | "instruction"; userText?: string; variant?: number }
): Promise<
  ActionResult<{
    context: ComposedContext
    settings: GenerationSettings
    /** Decided here, where the key is visible: real provider iff a key exists. */
    providerKind: ProviderKind
  }>
> {
  let instruction: string | null = null

  if (opts.mode === "instruction") {
    const trimmed = opts.userText?.trim() ?? ""
    if (trimmed === "")
      return { ok: false, error: "Write an instruction first." }
    instruction = trimmed
  } else if (opts.userText !== undefined) {
    const appended = await appendUserEntry(storyId, opts.userText)
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
    instruction,
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
