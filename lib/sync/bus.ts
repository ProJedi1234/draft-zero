// lib/sync/bus.ts — Process-global change bus. Server-only.
//
// The single place "the database moved" becomes "every open device hears about
// it". Deliberately in-process: this app is one Node server by design (see the
// pool comment in lib/db/client.ts), so a Set of callbacks IS the pub/sub — no
// Redis, no polling. Held on globalThis the same way the pool is, because dev
// HMR reloads modules while the SSE routes keep running against the old copy;
// two buses means a device that never hears anything again.
//
// Events carry no payload beyond identity. Subscribers (the /api/sync/events
// route) forward them to clients, and clients respond with router.refresh() —
// the refetch is the sync, so the bus never has to serialize story state.

import type { RunEndStatus } from "@/lib/sync/types"

export type BusEvent =
  | { kind: "change"; storyId: string | null }
  | { kind: "run-started"; storyId: string; runId: string }
  /**
   * A run finished, and HOW it finished. `change` already fires on the same
   * persist, but a refetch can only show that the story is no longer running —
   * it cannot distinguish a landed passage from a provider error, and the
   * sidebar has to mark those differently. This is the only carrier for that.
   */
  | {
      kind: "run-ended"
      storyId: string
      runId: string
      status: RunEndStatus
    }
  /**
   * This story's summarizer has failed enough times in a row to stop trying.
   * The only unprompted message in the app: everything else that toasts is an
   * answer to something the writer just did. It earns the interruption by
   * being the moment a background job stops being self-healing — before this
   * it retried for free every turn, after it nothing will happen at all.
   */
  | { kind: "summary-stopped"; storyId: string }

type BusListener = (event: BusEvent) => void

const globalForBus = globalThis as unknown as {
  __draftZeroBus: Set<BusListener> | undefined
}

const listeners = (globalForBus.__draftZeroBus ??= new Set<BusListener>())

/** Returns the unsubscribe. Listener errors are swallowed — one dead socket must not mute the rest. */
export function subscribeBus(listener: BusListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function publishBus(event: BusEvent): void {
  for (const listener of listeners) {
    try {
      listener(event)
    } catch {
      // A throwing subscriber is a broken socket, not a broken bus.
    }
  }
}

/**
 * "This story's persisted state moved." Call it wherever revalidatePath is
 * called after a write — the two are the same fact aimed at different caches:
 * revalidatePath refreshes the device that acted, this refreshes the ones that
 * didn't. Null for writes without a story (settings, the library list).
 */
export function touchStory(storyId: string | null): void {
  publishBus({ kind: "change", storyId })
}
