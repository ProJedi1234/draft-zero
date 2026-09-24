"use server"

import type { StoryPage } from "@/lib/db/queries"
import { NO_ORIGIN } from "@/lib/services/context"
import * as stories from "@/lib/services/stories"
import type { StoryRecord } from "@/lib/store/records"
import type { ActionResult, GenerationSettings } from "@/lib/types"

/**
 * One more window of the library for the sidebar's "Load more".
 *
 * An action rather than a route because the sidebar lives in the root layout:
 * it has no route of its own to re-render with a wider window, and a search
 * param would put the sidebar's scroll depth in the URL of whatever page the
 * writer happens to be on.
 */
export async function loadStoryPage(input: {
  offset: number
  query?: string
}): Promise<ActionResult<StoryPage>> {
  return stories.loadStoryPage(input)
}

export async function createStory(input?: {
  title?: string
  /** Client-minted, so the caller can render the row before this returns. */
  id?: string
  origin?: string
}): Promise<ActionResult<{ id: string; record: StoryRecord }>> {
  return stories.createStory(
    { title: input?.title, id: input?.id },
    { origin: input?.origin ?? null }
  )
}

/** Patch any of the story text-metadata fields. Only supplied keys are written. */
export async function updateStoryMeta(
  id: string,
  patch: {
    title?: string
    description?: string
    genre?: string
    memory?: string
    authorsNote?: string
    /** "" clears the override back to the built-in prompt. */
    systemPrompt?: string | null
    /** Whether new summary versions are written. See the schema's column note. */
    summarize?: boolean
  },
  opts?: { origin?: string }
): Promise<ActionResult<{ record: StoryRecord }>> {
  return stories.updateStoryMeta(
    { id, patch },
    { origin: opts?.origin ?? null }
  )
}

export async function updateStoryTint(
  id: string,
  patch: {
    /** Degrees, or null to clear the tint back to the neutral palette. */
    hue: number | null
    /** 0..1. Ignored when hue is null. */
    strength?: number
    /**
     * Whether the atmosphere call may keep choosing after this. Left undefined
     * leaves the flag alone; the swatch row passes false, because a colour
     * chosen by hand is a decision and not a starting point.
     */
    auto?: boolean
  },
  opts?: { origin?: string }
): Promise<ActionResult<{ record: StoryRecord }>> {
  return stories.updateStoryTint(
    { id, patch },
    { origin: opts?.origin ?? null }
  )
}

export async function setStoryTintAuto(
  id: string,
  auto: boolean,
  opts?: { origin?: string }
): Promise<ActionResult<{ record: StoryRecord }>> {
  return stories.setStoryTintAuto(
    { id, auto },
    { origin: opts?.origin ?? null }
  )
}

export async function duplicateStory(
  id: string,
  opts?: { copyId?: string; origin?: string }
): Promise<ActionResult<{ id: string; record: StoryRecord }>> {
  return stories.duplicateStory(
    { id, copyId: opts?.copyId },
    { origin: opts?.origin ?? null }
  )
}

export async function deleteStory(
  id: string,
  opts?: { origin?: string }
): Promise<ActionResult> {
  return stories.deleteStory({ id }, { origin: opts?.origin ?? null })
}

/** Publishes with no origin, as it always has: the caller passes none. */
export async function updateGenerationSettings(
  id: string,
  patch: Partial<GenerationSettings>
): Promise<ActionResult> {
  return stories.updateGenerationSettings({ id, patch }, NO_ORIGIN)
}

export async function setStoryImageModel(
  id: string,
  /** A concrete choice, or null to follow the app's default image model. */
  imageModelId: string | null
): Promise<ActionResult> {
  return stories.setStoryImageModel({ id, imageModelId }, NO_ORIGIN)
}
