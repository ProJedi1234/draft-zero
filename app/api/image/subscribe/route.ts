// GET /api/image/subscribe?storyId=…[&runId=…] — attach to a live image run.
//
// The image twin of /api/generation/subscribe, frame for frame: snapshot (the
// sharpest partial so far), live partials, terminal `end`. Closing this stream
// detaches a listener and nothing else — only the stopIllustration action
// aborts the draw. 204 answers "nothing to watch", which the client treats as
// idle rather than as an error.
import { attachImageRun, findImageRun } from "@/lib/images/live"
import { SYNC_PING_INTERVAL_MS, type ImageRunWireEvent } from "@/lib/sync/types"

// Node, explicitly: the registry lives on globalThis in this one process, and
// an edge isolate would see an empty one — every subscribe would 204 in a way
// that looks like a sync bug rather than a runtime one.
export const runtime = "nodejs"

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const storyId = url.searchParams.get("storyId")
  if (!storyId) {
    return Response.json({ error: "storyId is required." }, { status: 400 })
  }

  // No await between this lookup and the listener attach inside start() below —
  // both run in the same synchronous turn, so the snapshot the subscriber gets
  // and the events that follow it cannot have a gap between them.
  const run = findImageRun(storyId, url.searchParams.get("runId"))
  if (!run) return new Response(null, { status: 204 })

  const encoder = new TextEncoder()
  let cleanup: () => void = () => {}

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false
      const write = (event: ImageRunWireEvent) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"))
        } catch {
          // The socket died without cancel() having run yet — release the
          // listener and the ping here or they leak until the run GCs.
          cleanup()
        }
      }
      const finish = () => {
        const wasClosed = closed
        cleanup()
        if (!wasClosed) {
          try {
            controller.close()
          } catch {
            // Already closed by the consumer; nothing left to say.
          }
        }
      }

      const attachment = attachImageRun(run, (event) => {
        write(event)
        if (event.type === "end") finish()
      })
      const ping = setInterval(
        () => write({ type: "ping" }),
        SYNC_PING_INTERVAL_MS
      )
      cleanup = () => {
        closed = true
        clearInterval(ping)
        attachment.detach()
      }

      write(attachment.frame)
      // Attached inside the linger window: the run already finished, and its
      // whole story is snapshot + end.
      if (attachment.end) {
        write(attachment.end)
        finish()
      }
    },
    cancel() {
      // Detach only. The subscriber leaving says nothing about the draw.
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
