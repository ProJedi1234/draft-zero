// GET /api/sync/events — the long-lived "something changed" channel.
//
// Every open device holds one of these. It forwards the process-global bus
// (lib/sync/bus.ts) as NDJSON: `hello` first so the client knows the socket is
// really open, then `change` / `run-started` as they happen, with pings to keep
// intermediaries from reaping the idle connection. It carries no data beyond
// identity — the client answers `change` with router.refresh(), because with
// dynamic RSC the refetch IS the sync.
import { subscribeBus, type BusEvent } from "@/lib/sync/bus"
import { SYNC_PING_INTERVAL_MS, type SyncWireEvent } from "@/lib/sync/types"

// Node, explicitly: the bus is a Set on globalThis in this one process. An
// edge isolate would hold a private, silent bus — every device would connect
// fine and simply never hear anything.
export const runtime = "nodejs"

function toWire(event: BusEvent): SyncWireEvent {
  return event.kind === "change"
    ? { type: "change", storyId: event.storyId }
    : { type: "run-started", storyId: event.storyId, runId: event.runId }
}

export async function GET(): Promise<Response> {
  const encoder = new TextEncoder()
  let cleanup: () => void = () => {}

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false
      const write = (event: SyncWireEvent) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"))
        } catch {
          // The socket died without cancel() having run yet — and it never
          // will run for a stream that errored rather than being cancelled,
          // so the bus listener and the ping interval must be released here
          // or they leak for the life of the process. A dead subscriber must
          // never throw back into publishBus.
          cleanup()
        }
      }

      const unsubscribe = subscribeBus((event) => write(toWire(event)))
      const ping = setInterval(
        () => write({ type: "ping" }),
        SYNC_PING_INTERVAL_MS
      )
      cleanup = () => {
        closed = true
        clearInterval(ping)
        unsubscribe()
      }

      write({ type: "hello" })
    },
    cancel() {
      // A device leaving unhooks its listener and nothing else — the bus, the
      // registry and every run keep going exactly as they were.
      cleanup()
    },
  })

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
    },
  })
}
