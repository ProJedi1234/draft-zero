// lib/sync/client.ts — Browser half of the wire contract. Client-safe: no
// server imports, nothing here but fetch and a line parser.
//
// Both channels are NDJSON over plain fetch rather than EventSource because the
// server writes one JSON object per line and nothing else — no event names, no
// retry fields — and a hand-rolled reader is the only way to get the buffering
// rule right (see readNdjsonLines). Closing either stream detaches a listener
// and nothing else; only stopGeneration() aborts a model.

import {
  SYNC_PING_INTERVAL_MS,
  type DeriveRunWireEvent,
  type ImageRunWireEvent,
  type RunWireEvent,
  type SyncWireEvent,
} from "@/lib/sync/types"

/** The `run-ended` frame, narrowed out of the union for subscribers. */
export type RunEndedEvent = Extract<SyncWireEvent, { type: "run-ended" }>

/**
 * This tab's identity on the sync channel, minted once per page load. Its one
 * job is echo suppression: a `draft` event stamped with our own id is our own
 * keystroke coming back around the bus, and adopting it would fight the
 * textarea it came from. Not crypto.randomUUID — that is undefined outside a
 * secure context, and this app's LAN origin is plain HTTP.
 */
export const syncClientId =
  Math.random().toString(36).slice(2) + Date.now().toString(36)

/**
 * Silence past ~2 ping intervals means the socket is dead, per the contract.
 * iOS in particular kills a background PWA's sockets without an error or a
 * close — the read just never resolves again — so waiting on the network to
 * say goodbye means waiting forever. The margin over 2× keeps one delayed ping
 * from tearing down a healthy connection.
 */
const STALL_TIMEOUT_MS = SYNC_PING_INTERVAL_MS * 2.5

/**
 * True while a server-action transition on this device is already refreshing
 * the tree. The sync channel checks it before answering a `change` with
 * router.refresh(): the local revalidate and the bus echo of the same write are
 * one fact, and refreshing twice buys a second RSC round-trip for nothing.
 * A module singleton, not React state — the two hooks that share it never
 * render because of it. Counted, not boolean: transitions overlap.
 */
export const localRefresh = { pending: 0 }

/**
 * The story workspace currently mounted, if any — where the app-wide sync
 * channel routes run-started events and its reconnect probe. A module
 * singleton for the same reason localRefresh is: the channel holder lives in
 * the root layout (so the library and settings pages hear `change` too) while
 * the generation hook lives in the story-keyed subtree, and neither should
 * re-render or reconnect just because the other moved. Null on pages without
 * a story, where run-started has no one to tell.
 */
export const runHandoff: {
  current: {
    storyId: string
    /** A run began on this story somewhere — attach to it. */
    onRunStarted: (runId: string) => void
    /** An image run began on this story somewhere — attach to that channel. */
    onImageRunStarted: (runId: string) => void
    /**
     * The socket came back after being down. run-started events emitted in
     * the gap are gone for good — a device that slept through one would show
     * an idle composer under a live run forever — so this is where the
     * generation hook re-probes "is anything running?". Cheap when the answer
     * is no: one 204. The image and derivation hooks re-probe their own
     * channels off the same signal.
     */
    onReconnect: () => void
  } | null
} = { current: null }

/**
 * Run endings, fanned out to whoever is listening — in practice the library's
 * status marks. A module singleton for the same reason runHandoff is: the
 * channel holder lives in the root layout while the listener lives in the
 * sidebar, and neither should re-render or reconnect because of the other.
 *
 * Distinct from runHandoff, which routes a run to the ONE story workspace that
 * is open. This is the opposite audience: rows for stories nobody is looking
 * at, which is the only place an ending is news.
 */
export const runEndings = {
  listeners: new Set<(event: RunEndedEvent) => void>(),
  subscribe(listener: (event: RunEndedEvent) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  },
  publish(event: RunEndedEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // One broken subscriber must not mute the rest, same as the bus.
      }
    }
  },
}

/** The `draft` frame, narrowed out of the union for subscribers. */
export type DraftEvent = Extract<SyncWireEvent, { type: "draft" }>

/**
 * Composer drafts, fanned out to whichever story editor is mounted. A module
 * singleton for the same reason runEndings is: the channel holder lives in the
 * root layout while the composer lives in the story-keyed subtree. Subscribe-
 * only, with no memory of the last event — a device that was not listening
 * when a draft moved gets it from the DB row on the next story mount, and from
 * the resync probe on reconnect.
 */
export const draftRelay = {
  listeners: new Set<(event: DraftEvent) => void>(),
  subscribe(listener: (event: DraftEvent) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  },
  publish(event: DraftEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // One broken subscriber must not mute the rest, same as the bus.
      }
    }
  },
}

/** The `atmosphere` frame, narrowed out of the union for subscribers. */
export type AtmosphereEvent = Extract<SyncWireEvent, { type: "atmosphere" }>

/**
 * Where the atmosphere picker is, per story, for whoever is showing it — the
 * sparkle in the inspector and the chip in the header, which are never both
 * on screen but are both fed from here.
 *
 * A module singleton like runEndings, and for the same reason: the channel is
 * held by the root layout while the indicators live deep in the story subtree.
 * Unlike runEndings it also REMEMBERS the last phase per story, because the
 * indicator mounts and unmounts as the inspector opens and closes — a
 * subscribe-only fan-out would leave a panel opened one second after a failure
 * showing nothing at all.
 */
export const atmosphereStatus = {
  last: new Map<string, AtmosphereEvent>(),
  listeners: new Set<(event: AtmosphereEvent) => void>(),
  /** When "checking" was shown, per story — the floor below is measured from it. */
  shownAt: new Map<string, number>(),
  holds: new Map<string, ReturnType<typeof setTimeout>>(),
  subscribe(listener: (event: AtmosphereEvent) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  },
  publish(event: AtmosphereEvent): void {
    const pending = this.holds.get(event.storyId)
    if (pending !== undefined) {
      clearTimeout(pending)
      this.holds.delete(event.storyId)
    }
    if (event.phase === "checking") {
      this.shownAt.set(event.storyId, Date.now())
      this.commit(event)
      return
    }
    // The floor. A check against a fast model is over in about a second, and
    // it does not begin until the turn it follows has finished streaming — so
    // the writer is reading their new passage during the entire life of the
    // indicator, and an honest one is an indicator nobody has ever seen. This
    // holds the terminal phase back so the mark is legible when the eye
    // arrives. It delays no work and no colour: the tint is already written
    // and its own `change` event has already gone out.
    const shownAt = this.shownAt.get(event.storyId)
    const elapsed = shownAt === undefined ? Infinity : Date.now() - shownAt
    if (elapsed >= MIN_CHECKING_MS) {
      this.commit(event)
      return
    }
    this.holds.set(
      event.storyId,
      setTimeout(() => {
        this.holds.delete(event.storyId)
        this.commit(event)
      }, MIN_CHECKING_MS - elapsed)
    )
  },
  commit(event: AtmosphereEvent): void {
    this.last.set(event.storyId, event)
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // One broken subscriber must not mute the rest, same as the bus.
      }
    }
  },
}

/** How long "checking" stays on screen at minimum. See publish() above. */
const MIN_CHECKING_MS = 1400

/**
 * One NDJSON response to a stream of parsed records.
 *
 * Holds the tail of a read that stopped mid-line: a network read boundary has
 * nothing to do with our record boundary, so the last line of any read is only
 * complete if the read happened to end on a newline — parsing it eagerly is how
 * a passage loses a chunk of prose to a JSON error. Blank lines are the
 * ordinary result of a trailing delimiter; a line that does not parse is
 * dropped rather than thrown, because the half-finished passage on screen is
 * worth more than strictness about a frame we could not read.
 *
 * Throws on stall (see STALL_TIMEOUT_MS) so the caller's reconnect loop runs;
 * returns quietly on abort, because an abort is the caller's own decision.
 */
export async function* readNdjsonLines<T>(
  res: Response,
  signal?: AbortSignal
): AsyncGenerator<T> {
  if (!res.body) return

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  try {
    while (true) {
      if (signal?.aborted) return
      const { done, value } = await readWithStallGuard(reader)
      if (done || value === undefined) break

      buffer += decoder.decode(value, { stream: true })

      let newline: number
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        const record = parseLine<T>(line)
        if (record !== null) yield record
      }
    }

    // A stream that ended without a final newline still has a whole record in
    // the buffer; dropping it would silently lose the terminal frame, which is
    // always last.
    const record = parseLine<T>(buffer)
    if (record !== null) yield record
  } finally {
    reader.cancel().catch(() => {})
  }
}

async function readWithStallGuard(
  reader: ReadableStreamDefaultReader<Uint8Array>
): Promise<{ done: boolean; value?: Uint8Array }> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("sync stream stalled")),
          STALL_TIMEOUT_MS
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

function parseLine<T>(line: string): T | null {
  const trimmed = line.trim()
  if (trimmed === "") return null
  try {
    return JSON.parse(trimmed) as T
  } catch {
    return null
  }
}

/**
 * Attaches to a story's live generation run. Resolves null on 204 — nothing
 * running and nothing lingering — which is an answer, not an error: the mount
 * probe uses it to conclude "idle". With a runId the question narrows to that
 * specific run, so a device chasing a run-started event cannot accidentally
 * adopt a different, later run under the same story.
 */
export async function subscribeRun(
  storyId: string,
  runId: string | null,
  signal: AbortSignal
): Promise<AsyncGenerator<RunWireEvent> | null> {
  const params = new URLSearchParams({ storyId })
  if (runId !== null) params.set("runId", runId)
  const res = await fetch(`/api/generation/subscribe?${params.toString()}`, {
    signal,
    cache: "no-store",
  })
  if (res.status === 204) return null
  if (!res.ok) throw new Error(`subscribe failed (${res.status})`)
  return readNdjsonLines<RunWireEvent>(res, signal)
}

/**
 * Attaches to a story's live IMAGE run — the picture twin of subscribeRun,
 * same 204-means-idle contract, against its own route and registry.
 */
export async function subscribeImageRun(
  storyId: string,
  runId: string | null,
  signal: AbortSignal
): Promise<AsyncGenerator<ImageRunWireEvent> | null> {
  const params = new URLSearchParams({ storyId })
  if (runId !== null) params.set("runId", runId)
  const res = await fetch(`/api/image/subscribe?${params.toString()}`, {
    signal,
    cache: "no-store",
  })
  if (res.status === 204) return null
  if (!res.ok) throw new Error(`image subscribe failed (${res.status})`)
  return readNdjsonLines<ImageRunWireEvent>(res, signal)
}

/**
 * Attaches to a story's live prompt DERIVATION — the third channel, same
 * 204-means-idle contract, against its own route and registry.
 */
export async function subscribeDeriveRun(
  storyId: string,
  runId: string | null,
  signal: AbortSignal
): Promise<AsyncGenerator<DeriveRunWireEvent> | null> {
  const params = new URLSearchParams({ storyId })
  if (runId !== null) params.set("runId", runId)
  const res = await fetch(`/api/image-prompt/subscribe?${params.toString()}`, {
    signal,
    cache: "no-store",
  })
  if (res.status === 204) return null
  if (!res.ok) throw new Error(`derive subscribe failed (${res.status})`)
  return readNdjsonLines<DeriveRunWireEvent>(res, signal)
}

/** Opens the long-lived "something changed" channel. */
export async function openSyncChannel(
  signal: AbortSignal
): Promise<AsyncGenerator<SyncWireEvent>> {
  const res = await fetch("/api/sync/events", { signal, cache: "no-store" })
  if (!res.ok) throw new Error(`sync channel failed (${res.status})`)
  return readNdjsonLines<SyncWireEvent>(res, signal)
}
