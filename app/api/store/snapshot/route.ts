// GET /api/store/snapshot — server truth for the client store's gap recovery.
//
// The socket carries every write as it happens; this is what fills the holes a
// socket cannot: a cold boot, a tab that was asleep, a reconnect after the
// backoff ladder. Three modes, because the cost of the three is wildly
// different — `full` runs the word-count aggregate over every manuscript and is
// for boot only, `delta` runs it over what has moved and pays a single-table
// scan for the deletion sweep's ground truth, `scoped` reads one story.
import { getDb } from "@/lib/db/client"
import { listStoryIdVersions, listStoryRecords } from "@/lib/db/queries"

// Node, matching every other route here: the pg pool is a singleton in this
// process, and the aggregate below is not something to run on an edge isolate.
export const runtime = "nodejs"

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams
  const storyId = params.get("storyId")
  const since = params.get("since")

  const db = await getDb()

  // scoped wins over since: a caller that sent both is asking about one story.
  if (storyId) {
    const rows = await listStoryRecords({ storyId })
    return json({
      serverTime: new Date().toISOString(),
      entity: "story",
      mode: "scoped",
      // An empty array IS the answer for a story that no longer exists — the
      // client reads the absence as a delete, so a 404 would tell it nothing.
      rows,
    })
  }

  if (since !== null) {
    // Both reads in one transaction: the id list decides what the client
    // deletes, so a story committed between the two would otherwise be missing
    // from allIds and swept off a device that had just been told about it.
    const { rows, allIds } = await db.transaction(async (tx) => ({
      rows: await listStoryRecords({ since, tx }),
      allIds: await listStoryIdVersions(tx),
    }))
    return json({
      serverTime: new Date().toISOString(),
      entity: "story",
      mode: "delta",
      rows,
      allIds,
    })
  }

  const rows = await listStoryRecords()
  return json({
    serverTime: new Date().toISOString(),
    entity: "story",
    mode: "full",
    // No allIds: a full snapshot's own rows are the complete id list.
    rows,
  })
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  })
}
