// lib/store/lorebook-mutations.ts — Lorebook CRUD as optimistic mutations.
//
// The lorebook's twin of story-mutations.ts, and the same three rules: the
// client mints the id so the row is on screen before the server is asked,
// validation is duplicated from the action so a write the server would refuse
// never reaches the overlay, and the action's returned record is what confirms
// the patch — never a re-read.

import {
  createLorebookEntry,
  deleteLorebookEntry,
  updateLorebookEntry,
} from "@/lib/actions/lorebook"
import { randomId } from "@/lib/id"
import { mutationQueue, type CanonicalRow } from "@/lib/store/mutation-queue"
import { isValidEntityId, type LorebookEntryRecord } from "@/lib/store/records"
import { syncClientId } from "@/lib/sync/client"
import type { ActionResult, NewLorebookEntry } from "@/lib/types"

interface LorebookActions {
  createLorebookEntry: typeof createLorebookEntry
  updateLorebookEntry: typeof updateLorebookEntry
  deleteLorebookEntry: typeof deleteLorebookEntry
}

const DEFAULT_ACTIONS: LorebookActions = {
  createLorebookEntry,
  updateLorebookEntry,
  deleteLorebookEntry,
}

const actions: LorebookActions = { ...DEFAULT_ACTIONS }

/** Test seam: no arguments restores the real actions. */
export function setLorebookMutationDepsForTests(
  patch?: Partial<LorebookActions>
): void {
  Object.assign(actions, DEFAULT_ACTIONS, patch ?? {})
}

const INVALID_ID = "Invalid entry id."
const INVALID_STORY = "Invalid story id."
const EMPTY_NAME = "Name is required."

/**
 * The create, split so the caller can select the new entry before the insert
 * lands — the same shape as startStoryCreate, for the same reason: the dialog
 * closes into an editor, and the editor needs an id now.
 */
export function startLorebookCreate(
  storyId: string,
  input: NewLorebookEntry
): {
  id: string
  settled: Promise<ActionResult<{ record: LorebookEntryRecord }>>
} {
  const id = randomId()
  const now = new Date().toISOString()
  const name = input.name.trim()

  const ghost: LorebookEntryRecord = {
    id,
    storyId,
    name,
    category: input.category,
    keys: input.keys ?? [],
    content: input.content ?? "",
    enabled: input.enabled ?? true,
    alwaysActive: input.alwaysActive ?? false,
    priority: input.priority ?? 50,
    // Rendering placeholders. A pending row is never version-compared: the
    // overlay wins by being the overlay, and the confirm replaces both.
    createdAt: now,
    updatedAt: now,
  }

  const settled = (async (): Promise<
    ActionResult<{ record: LorebookEntryRecord }>
  > => {
    if (!isValidEntityId(storyId)) return { ok: false, error: INVALID_STORY }
    if (name === "") return { ok: false, error: EMPTY_NAME }

    const outcome = await mutationQueue.enqueue({
      id: randomId(),
      label: "New lore entry",
      patches: [{ entity: "lorebook-entry", op: "upsert", row: ghost }],
      async run() {
        const res = await actions.createLorebookEntry(storyId, input, {
          id,
          origin: syncClientId,
        })
        if (!res.ok) return { ok: false, error: res.error }
        return { ok: true, canonical: [upsertOf(res.data.record)] }
      },
    })
    return outcome.ok ? { ok: true, data: { record: ghost } } : outcome
  })()

  return { id, settled }
}

export async function updateLorebookEntryOptimistic(
  id: string,
  patch: Partial<NewLorebookEntry>
): Promise<ActionResult> {
  if (!isValidEntityId(id)) return { ok: false, error: INVALID_ID }

  const fields: Partial<LorebookEntryRecord> = {}
  if (patch.name !== undefined) {
    const name = patch.name.trim()
    if (name === "") return { ok: false, error: EMPTY_NAME }
    fields.name = name
  }
  if (patch.category !== undefined) fields.category = patch.category
  if (patch.keys !== undefined) fields.keys = patch.keys
  if (patch.content !== undefined) fields.content = patch.content
  if (patch.enabled !== undefined) fields.enabled = patch.enabled
  if (patch.alwaysActive !== undefined) fields.alwaysActive = patch.alwaysActive
  if (patch.priority !== undefined) fields.priority = patch.priority

  // Nothing to say. Enqueueing an empty merge would still cost a round trip and
  // a queue slot, and the autosave debounce does produce these.
  if (Object.keys(fields).length === 0) return { ok: true, data: null }

  // No updatedAt: the client does not mint the value the store arbitrates on.
  const outcome = await mutationQueue.enqueue({
    id: randomId(),
    label: "Edit lore entry",
    patches: [{ entity: "lorebook-entry", op: "merge", id, fields }],
    async run() {
      const res = await actions.updateLorebookEntry(id, patch, {
        origin: syncClientId,
      })
      if (!res.ok) return { ok: false, error: res.error }
      return { ok: true, canonical: [upsertOf(res.data.record)] }
    },
  })

  return outcome.ok ? { ok: true, data: null } : outcome
}

export async function deleteLorebookEntryOptimistic(
  id: string
): Promise<ActionResult> {
  if (!isValidEntityId(id)) return { ok: false, error: INVALID_ID }

  const outcome = await mutationQueue.enqueue({
    id: randomId(),
    label: "Delete lore entry",
    patches: [{ entity: "lorebook-entry", op: "delete", id }],
    async run() {
      const res = await actions.deleteLorebookEntry(id, {
        origin: syncClientId,
      })
      if (!res.ok) return { ok: false, error: res.error }
      return {
        ok: true,
        canonical: [
          {
            entity: "lorebook-entry",
            op: "delete",
            id,
            version: res.data.version,
          },
        ],
      }
    },
  })

  return outcome.ok ? { ok: true, data: null } : outcome
}

function upsertOf(record: LorebookEntryRecord): CanonicalRow {
  return {
    entity: "lorebook-entry",
    op: "upsert",
    id: record.id,
    version: record.updatedAt,
    row: record,
  }
}
