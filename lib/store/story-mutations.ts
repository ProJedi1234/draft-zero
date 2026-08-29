// lib/store/story-mutations.ts — Story CRUD as optimistic mutations.
//
// Each of these mints the id, builds the patch the surfaces render immediately,
// and hands the server call to the queue. Validation is duplicated from the
// actions on purpose: a write the server would refuse must never reach the
// overlay, because the only way back out of the overlay is a rollback the
// writer watches happen.

import {
  createStory,
  deleteStory,
  duplicateStory,
  setStoryTintAuto,
  updateStoryMeta,
  updateStoryTint,
} from "@/lib/actions/stories"
import { randomId } from "@/lib/id"
import { mutationQueue, type CanonicalRow } from "@/lib/store/mutation-queue"
import { isValidEntityId, type StoryRecord } from "@/lib/store/records"
import { syncClientId } from "@/lib/sync/client"
import type { ActionResult, StorySummary } from "@/lib/types"

interface StoryActions {
  createStory: typeof createStory
  updateStoryMeta: typeof updateStoryMeta
  updateStoryTint: typeof updateStoryTint
  setStoryTintAuto: typeof setStoryTintAuto
  deleteStory: typeof deleteStory
  duplicateStory: typeof duplicateStory
}

const DEFAULT_ACTIONS: StoryActions = {
  createStory,
  updateStoryMeta,
  updateStoryTint,
  setStoryTintAuto,
  deleteStory,
  duplicateStory,
}

const actions: StoryActions = { ...DEFAULT_ACTIONS }

/** Test seam: no arguments restores the real actions. */
export function setStoryMutationDepsForTests(
  patch?: Partial<StoryActions>
): void {
  Object.assign(actions, DEFAULT_ACTIONS, patch ?? {})
}

const INVALID_ID = "Invalid story id."
const EMPTY_TITLE = "Title can't be empty."

/**
 * The create, split so the caller can navigate before the insert lands.
 *
 * `id` is available synchronously because the client mints it, and the ghost
 * row is in the store before this returns — so the route it names can be
 * pushed immediately and the shell has a title to paint. `settled` resolves
 * when the write is confirmed (or finally fails), which is only interesting for
 * the error toast.
 */
export function startStoryCreate(): {
  id: string
  settled: Promise<ActionResult<{ id: string }>>
} {
  const id = randomId()
  const now = new Date().toISOString()
  const ghost: StoryRecord = {
    id,
    title: "Untitled Story",
    description: "",
    genre: "",
    // Placeholders for rendering only. A pending row sorts by queue order, so
    // these are never compared against a server-minted version.
    createdAt: now,
    updatedAt: now,
    wordCount: 0,
    tintHue: null,
    tintStrength: 1,
    tintAuto: true,
  }

  // enqueue applies the ghost to the store synchronously, so the row exists
  // before this promise is awaited by anyone.
  const settled = mutationQueue
    .enqueue({
      id: randomId(),
      label: "New story",
      patches: [{ entity: "story", op: "upsert", row: ghost }],
      async run() {
        // The client-minted id is the idempotency key: a retry after a lost
        // response confirms the write that landed instead of failing on its PK.
        const res = await actions.createStory({ id, origin: syncClientId })
        if (!res.ok) return { ok: false, error: res.error }
        return { ok: true, canonical: [upsertOf(res.data.record)] }
      },
    })
    .then<ActionResult<{ id: string }>>((outcome) =>
      outcome.ok ? { ok: true, data: { id } } : outcome
    )

  return { id, settled }
}

/** The awaited form, for callers with nothing to do until the write lands. */
export async function createStoryOptimistic(): Promise<
  ActionResult<{ id: string }>
> {
  return startStoryCreate().settled
}

export async function updateStoryMetaOptimistic(
  id: string,
  patch: { title?: string; description?: string; genre?: string }
): Promise<ActionResult> {
  if (!isValidEntityId(id)) return { ok: false, error: INVALID_ID }

  const sent: { title?: string; description?: string; genre?: string } = {}
  if (patch.title !== undefined) {
    const trimmed = patch.title.trim()
    if (trimmed === "") return { ok: false, error: EMPTY_TITLE }
    sent.title = trimmed
  }
  if (patch.description !== undefined) sent.description = patch.description
  if (patch.genre !== undefined) sent.genre = patch.genre

  // Exactly the given fields and no updatedAt: the client clock never fabricates
  // a version-adjacent value. Pending rows sort by queue order in the view.
  return enqueueMerge(id, "Rename story", sent, () =>
    actions.updateStoryMeta(id, sent, { origin: syncClientId })
  )
}

export async function updateStoryTintOptimistic(
  id: string,
  patch: { hue: number | null; strength?: number; auto?: boolean }
): Promise<ActionResult> {
  if (!isValidEntityId(id)) return { ok: false, error: INVALID_ID }

  const hue = clampHue(patch.hue)
  const strength = clampStrength(patch.strength)

  const fields: Partial<StoryRecord> = { tintHue: hue }
  if (strength !== undefined) fields.tintStrength = strength
  if (patch.auto !== undefined) fields.tintAuto = patch.auto

  return enqueueMerge(id, "Set tint", fields, () =>
    actions.updateStoryTint(
      id,
      {
        hue,
        ...(strength === undefined ? {} : { strength }),
        ...(patch.auto === undefined ? {} : { auto: patch.auto }),
      },
      { origin: syncClientId }
    )
  )
}

export async function setStoryTintAutoOptimistic(
  id: string,
  auto: boolean
): Promise<ActionResult> {
  if (!isValidEntityId(id)) return { ok: false, error: INVALID_ID }
  return enqueueMerge(id, "Set tint mode", { tintAuto: auto }, () =>
    actions.setStoryTintAuto(id, auto, { origin: syncClientId })
  )
}

export async function deleteStoryOptimistic(id: string): Promise<ActionResult> {
  if (!isValidEntityId(id)) return { ok: false, error: INVALID_ID }

  const outcome = await mutationQueue.enqueue({
    id: randomId(),
    label: "Delete story",
    patches: [{ entity: "story", op: "delete", id }],
    async run() {
      const res = await actions.deleteStory(id, { origin: syncClientId })
      if (!res.ok) return { ok: false, error: res.error }
      // A local clock is enough here: the tombstone only has to beat stale
      // upserts already in flight, and the next snapshot re-proves the absence.
      return {
        ok: true,
        canonical: [
          {
            entity: "story",
            op: "delete",
            id,
            version: new Date().toISOString(),
          },
        ],
      }
    },
  })

  return outcome.ok ? { ok: true, data: null } : outcome
}

export async function duplicateStoryOptimistic(
  sourceId: string,
  seed: StorySummary
): Promise<ActionResult<{ id: string }>> {
  if (!isValidEntityId(sourceId)) return { ok: false, error: INVALID_ID }

  const copyId = randomId()
  const now = new Date().toISOString()
  const ghost: StoryRecord = {
    id: copyId,
    title: `${seed.title} (copy)`,
    description: seed.description,
    genre: seed.genre,
    createdAt: now,
    updatedAt: now,
    // The copy's manuscript is counted by the server; 0 until it answers.
    wordCount: 0,
    tintHue: seed.tintHue,
    tintStrength: seed.tintStrength,
    tintAuto: true,
  }

  const outcome = await mutationQueue.enqueue({
    id: randomId(),
    label: "Duplicate story",
    patches: [{ entity: "story", op: "upsert", row: ghost }],
    async run() {
      const res = await actions.duplicateStory(sourceId, {
        copyId,
        origin: syncClientId,
      })
      if (!res.ok) return { ok: false, error: res.error }
      return { ok: true, canonical: [upsertOf(res.data.record)] }
    },
  })

  return outcome.ok ? { ok: true, data: { id: copyId } } : outcome
}

async function enqueueMerge(
  id: string,
  label: string,
  fields: Partial<StoryRecord>,
  call: () => Promise<ActionResult<{ record: StoryRecord }>>
): Promise<ActionResult> {
  const outcome = await mutationQueue.enqueue({
    id: randomId(),
    label,
    patches: [{ entity: "story", op: "merge", id, fields }],
    async run() {
      // Next wraps every server-action call in its own startTransition
      // (next/dist/client/app-call-server.js), so the revalidatePath payload
      // does apply here; the covered-change echo is the guaranteed path anyway.
      const res = await call()
      if (!res.ok) return { ok: false, error: res.error }
      return { ok: true, canonical: [upsertOf(res.data.record)] }
    },
  })

  return outcome.ok ? { ok: true, data: null } : outcome
}

function upsertOf(record: StoryRecord): CanonicalRow {
  return {
    entity: "story",
    op: "upsert",
    id: record.id,
    version: record.updatedAt,
    row: record,
  }
}

/** Mirrors the server's clamp exactly — see updateStoryTint. */
function clampHue(hue: number | null): number | null {
  if (hue === null || !Number.isFinite(hue)) return null
  return ((Math.round(hue) % 360) + 360) % 360
}

function clampStrength(strength: number | undefined): number | undefined {
  if (strength === undefined || !Number.isFinite(strength)) return undefined
  return Math.min(1, Math.max(0, strength))
}
