"use server"

import * as lorebook from "@/lib/services/lorebook"
import type { ActionResult, LorebookEntry, NewLorebookEntry } from "@/lib/types"

/** Who acted, so the bus echo can be ignored on the device that wrote it. */
type Origin = { origin?: string | null }

export async function createLorebookEntry(
  storyId: string,
  input: NewLorebookEntry,
  options: Origin & { id?: string } = {}
): Promise<ActionResult<{ record: LorebookEntry }>> {
  return lorebook.createLorebookEntry(
    { ...input, storyId, id: options.id },
    { origin: options.origin ?? null }
  )
}

export async function updateLorebookEntry(
  id: string,
  patch: Partial<NewLorebookEntry>,
  options: Origin = {}
): Promise<ActionResult<{ record: LorebookEntry }>> {
  return lorebook.updateLorebookEntry(
    { id, patch },
    { origin: options.origin ?? null }
  )
}

export async function deleteLorebookEntry(
  id: string,
  options: Origin = {}
): Promise<ActionResult<{ storyId: string; version: string }>> {
  return lorebook.deleteLorebookEntry(
    { id },
    { origin: options.origin ?? null }
  )
}
