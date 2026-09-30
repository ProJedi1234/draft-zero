// GET /api/library — the library index's payload (lib/payloads/library.ts):
// excerpts, the picture rail, and the runs in flight. The stories themselves
// come from GET /api/store/snapshot.
import { buildLibraryPayload } from "@/lib/payloads/library"

// Node, explicitly: the run registries live on globalThis in this one process,
// and an edge isolate would report nothing running.
export const runtime = "nodejs"

export async function GET(): Promise<Response> {
  return Response.json(await buildLibraryPayload(), {
    headers: { "cache-control": "no-store" },
  })
}
