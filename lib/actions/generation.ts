"use server"

import { revalidatePath } from "next/cache"

import { NO_ORIGIN } from "@/lib/services/context"
import * as generation from "@/lib/services/generation"
import type {
  ActionKind,
  ActionResult,
  GenerationRequestKind,
} from "@/lib/types"

export async function startGeneration(
  storyId: string,
  opts: {
    kind?: ActionKind
    userText?: string
    turnId?: string
    variantGroupId?: string
    removingEntryIds?: string[]
    requestKind?: GenerationRequestKind
    profileId?: string
  }
): Promise<ActionResult<{ runId: string; userEntryId: string | null }>> {
  return generation.startGeneration({ ...opts, storyId }, NO_ORIGIN)
}

/** Aborts the story's run; see the service for which run a Stop may reach. */
export async function stopGeneration(
  storyId: string,
  runId?: string | null,
  startTurnId?: string | null
): Promise<void> {
  await generation.stopGeneration({ storyId, runId, startTurnId }, NO_ORIGIN)
}

/**
 * Refreshes the story tree without writing anything.
 *
 * The client needs this because startGeneration deliberately doesn't
 * revalidate: on the paths where the turn ends without a generated passage
 * (stopped before the first token, provider error, context composition failure)
 * the writer's row is on disk and nothing else would ever fetch it, so the
 * optimistic echo would be all that's holding the passage on screen.
 *
 * Deliberately no bus touch: every caller is reacting to something the other
 * devices were already told about (finishRun's touchStory, or a write whose
 * action broadcast for itself), so this refreshes the CALLER's tree and says
 * nothing. Broadcasting here made every mirroring device's settle refresh fan
 * out to all the others — N devices, N² refreshes per run end, all delivering
 * a tree nobody's copy of had changed.
 */
export async function syncStoryTree(): Promise<void> {
  revalidatePath("/", "layout")
}
