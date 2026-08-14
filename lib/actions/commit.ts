// lib/actions/commit.ts — The two refreshes every request-scoped write owes,
// as one call so a mutator cannot make one and forget the other:
// revalidatePath for the device that acted, touchStory for every device that
// didn't. Only for request scope — the run loop's detached settle path has no
// request to revalidate and touches the bus directly (see lib/generation/
// live.ts).
import "server-only"

import { revalidatePath } from "next/cache"

import { touchStory } from "@/lib/sync/bus"

/**
 * Announce a committed write. `storyId` scopes the bus event: the story whose
 * persisted state moved, or null for library-level writes (create, delete,
 * import, app settings) — anything a device not on any story must still hear.
 * Call it only after the transaction committed; the cache must never be told
 * about rows a rollback took back.
 */
export function commitChange(storyId: string | null): void {
  revalidatePath("/", "layout")
  touchStory(storyId)
}
