// /api/draft — the composer's unsent state (text + armed mode), saved and
// fanned out.
//
// POST upserts the story's draft row and publishes a `draft` bus event that
// CARRIES the state, so every other device on the story adopts it straight
// from the wire — no revalidatePath, no touchStory, no refetch. That is the
// whole reason this is a route and not a server action through commitChange: a
// draft changes on a debounce cadence while the writer types, and each change
// is a few hundred bytes nobody else's render depends on. Announcing it as a
// `change` would buy a full RSC round-trip per keystroke burst for a value the
// event can simply state.
//
// An empty draft is still an UPSERT, not a delete: the row outlives the words
// because `mode` does — a writer who just sent a Say is still speaking, on
// every device and after a restart. Absence means only "never touched". The
// clear travels as the same event with empty text, which is how a move sent on
// one device empties the composer on the rest.
//
// GET is the resync probe: a device whose socket was down missed any draft
// events emitted in the gap, and the reconnect refresh cannot recover them
// (the draft deliberately never rides the RSC payload after mount). One read
// of the row is their sum, exactly as one refresh is the sum of missed
// `change` events.
import { eq } from "drizzle-orm"

import { getDb } from "@/lib/db/client"
import { composerDrafts } from "@/lib/db/schema"
import { publishBus } from "@/lib/sync/bus"
import type { ComposerMode } from "@/lib/types"

// Node, explicitly: the bus is a Set on globalThis in this one process — an
// edge isolate would save the row and announce it to nobody.
export const runtime = "nodejs"

/** Well past any plausible move; a body over this is a bug, not a draft. */
const MAX_DRAFT_CHARS = 100_000

function isComposerMode(value: unknown): value is ComposerMode {
  return value === "do" || value === "say" || value === "image"
}

export async function POST(req: Request): Promise<Response> {
  let storyId: string
  let text: string
  let mode: ComposerMode
  let origin: string
  try {
    const body = (await req.json()) as {
      storyId?: unknown
      text?: unknown
      mode?: unknown
      origin?: unknown
    }
    if (typeof body.storyId !== "string" || body.storyId === "") {
      return Response.json({ error: "storyId is required." }, { status: 400 })
    }
    if (typeof body.text !== "string" || body.text.length > MAX_DRAFT_CHARS) {
      return Response.json({ error: "Malformed draft." }, { status: 400 })
    }
    if (!isComposerMode(body.mode)) {
      return Response.json({ error: "Malformed mode." }, { status: 400 })
    }
    if (typeof body.origin !== "string" || body.origin === "") {
      return Response.json({ error: "origin is required." }, { status: 400 })
    }
    storyId = body.storyId
    text = body.text
    mode = body.mode
    origin = body.origin
  } catch {
    return Response.json({ error: "Malformed request." }, { status: 400 })
  }

  const db = await getDb()
  const version = new Date().toISOString()
  try {
    await db
      .insert(composerDrafts)
      .values({ storyId, text, mode, updatedAt: version })
      .onConflictDoUpdate({
        target: composerDrafts.storyId,
        set: { text, mode, updatedAt: version },
      })
  } catch {
    // The FK is the only expected failure: the story was deleted under the
    // draft. Nothing to keep and nobody to tell.
    return Response.json({ error: "Story not found." }, { status: 404 })
  }

  publishBus({ kind: "draft", storyId, text, mode, version, origin })
  return Response.json({ version })
}

export async function GET(req: Request): Promise<Response> {
  const storyId = new URL(req.url).searchParams.get("storyId")
  if (storyId === null || storyId === "") {
    return Response.json({ error: "storyId is required." }, { status: 400 })
  }

  const db = await getDb()
  const row = await db
    .select()
    .from(composerDrafts)
    .where(eq(composerDrafts.storyId, storyId))
    .limit(1)
    .then((rows) => rows[0])

  // 204 is an answer, not an error — same contract as the subscribe routes:
  // this composer has never been touched. (A cleared draft is a row with
  // empty text, so the probe still learns the armed mode from it.)
  if (row === undefined) return new Response(null, { status: 204 })
  return Response.json({
    text: row.text,
    mode: row.mode,
    version: row.updatedAt,
  })
}
