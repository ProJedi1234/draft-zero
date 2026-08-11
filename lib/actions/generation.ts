"use server"

import { revalidatePath } from "next/cache"

import { getStory, listLorebookEntries } from "@/lib/db/queries"
import { composeContext } from "@/lib/generation/context"
import type { ComposedContext } from "@/lib/generation/types"
import type { ActionResult, GenerationSettings } from "@/lib/types"

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
  ActionResult<{ context: ComposedContext; settings: GenerationSettings }>
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

  const [story, lorebookEntries] = await Promise.all([
    getStory(storyId),
    listLorebookEntries(),
  ])

  if (!story) return { ok: false, error: "Story not found." }

  const context = composeContext({
    story,
    lorebookEntries,
    instruction,
    variant: opts.variant ?? 0,
  })

  revalidatePath("/", "layout")
  return { ok: true, data: { context, settings: story.settings } }
}
