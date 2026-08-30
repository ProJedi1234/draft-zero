// lib/actions/commit.ts — The two refreshes every request-scoped write owes,
// as one call so a mutator cannot make one and forget the other:
// revalidatePath for the device that acted, touchStory for every device that
// didn't. Only for request scope — the run loop's detached settle path has no
// request to revalidate and touches the bus directly (see lib/generation/
// live.ts), which is what the publish* variants below are for.
import "server-only"

import { revalidatePath } from "next/cache"

import type {
  EntityKind,
  LorebookEntryRecord,
  StoryRecord,
} from "@/lib/store/records"
import { publishBus } from "@/lib/sync/bus"

/**
 * Announce a committed write. `storyId` scopes the bus event: the story whose
 * persisted state moved, or null for library-level writes (create, delete,
 * import, app settings) — anything a device not on any story must still hear.
 * Call it only after the transaction committed; the cache must never be told
 * about rows a rollback took back.
 *
 * `entities` names which kinds moved, so a store-lane client can skip a
 * catch-up read for a table it does not hold. Omitting it is the safe default:
 * an unmarked write is caught up in full.
 */
export function commitChange(
  storyId: string | null,
  entities?: EntityKind[]
): void {
  revalidatePath("/", "layout")
  publishBus({ kind: "change", storyId, ...(entities ? { entities } : {}) })
}

/**
 * Bus-only publication of a committed story write — for detached (run-loop)
 * paths that have no request to revalidate, mirroring lib/generation/live.ts.
 *
 * `changeScope` is the accompanying change event's scope, which is not always
 * the story's own id: a create or a duplicate has to reach devices that are on
 * no story at all, so those pass null.
 */
export function publishStoryUpsert(
  record: StoryRecord,
  origin: string | null,
  changeScope: string | null = record.id
): void {
  publishBus({
    kind: "entity",
    op: "upsert",
    entity: "story",
    id: record.id,
    storyId: record.id,
    version: record.updatedAt,
    origin,
    data: record,
  })
  publishBus({ kind: "change", storyId: changeScope, covered: true })
}

/** Request-scoped variant: revalidatePath for the acting device, then publish. */
export function commitStoryUpsert(
  record: StoryRecord,
  origin: string | null,
  changeScope: string | null = record.id
): void {
  revalidatePath("/", "layout")
  publishStoryUpsert(record, origin, changeScope)
}

/**
 * A committed lorebook write, announced the way story writes are: the row rides
 * the bus so a store-lane device needs no read, and revalidatePath still fires
 * for the RSC lane, which renders the same entries in the inspector's lore tab.
 *
 * Scoped to the story rather than null — lore belongs to exactly one story, and
 * a device reading a different one has nothing to catch up on.
 */
export function commitLorebookUpsert(
  record: LorebookEntryRecord,
  origin: string | null
): void {
  revalidatePath("/", "layout")
  publishBus({
    kind: "entity",
    op: "upsert",
    entity: "lorebook-entry",
    id: record.id,
    storyId: record.storyId,
    version: record.updatedAt,
    origin,
    data: record,
  })
  publishBus({ kind: "change", storyId: record.storyId, covered: true })
}

/** The delete half. `version` is the deleting write's clock — see the store. */
export function commitLorebookDelete(
  id: string,
  storyId: string,
  version: string,
  origin: string | null
): void {
  revalidatePath("/", "layout")
  publishBus({
    kind: "entity",
    op: "delete",
    entity: "lorebook-entry",
    id,
    storyId,
    version,
    origin,
  })
  publishBus({ kind: "change", storyId, covered: true })
}

/** The delete half of publishStoryUpsert. Scope is always null: the story is gone. */
export function publishStoryDelete(
  id: string,
  version: string,
  origin: string | null
): void {
  publishBus({
    kind: "entity",
    op: "delete",
    entity: "story",
    id,
    storyId: id,
    version,
    origin,
  })
  publishBus({ kind: "change", storyId: null, covered: true })
}

export function commitStoryDelete(
  id: string,
  version: string,
  origin: string | null
): void {
  revalidatePath("/", "layout")
  publishStoryDelete(id, version, origin)
}
