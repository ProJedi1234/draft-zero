// POST /api/generate — server-side streaming proxy. The only place the
// OpenRouter key and the SDK meet a request. NDJSON chunked response — one
// GenerationEvent per line — because the stream now carries four kinds of
// thing (call identity, reasoning ticks, prose, final usage) and bare text
// could only carry one. Pre-stream failures answer JSON { error } with a real
// status.
//
// It is also the spend recorder, for the one reason that decides where such a
// thing can live: every other candidate only runs when the generation SUCCEEDS.
// A stopped stream and a provider error are both billed and neither leaves a
// passage behind, so the row is opened here before the first byte and settled in
// the `finally` that every ending passes through.
import { eq } from "drizzle-orm"
import { after } from "next/server"

import { getDb } from "@/lib/db/client"
import { stories } from "@/lib/db/schema"
import { recordCallStarted, settleCall } from "@/lib/generation/calls"
import { resolveOpenRouterKey } from "@/lib/generation/key"
import {
  mapOpenRouterError,
  streamCompletion,
} from "@/lib/generation/openrouter"
import { reconcileCall, shouldReconcile } from "@/lib/generation/reconcile"
import type {
  ComposedContext,
  GenerationEvent,
  GenerationUsage,
} from "@/lib/generation/types"
import type {
  GenerationRequestKind,
  GenerationSettings,
  SettledCallStatus,
} from "@/lib/types"

/**
 * Node, explicitly, now that this route is also the spend recorder.
 *
 * It was implicitly Node before and would still default to it — but the reason
 * has changed. This handler now imports the Postgres pool and `after()`, and
 * neither survives the edge runtime: a route that used to need nothing but
 * `fetch` would fail here in a way that looks like a generation bug rather than
 * a runtime one. Stating it is cheaper than rediscovering it.
 */
export const runtime = "nodejs"

const REQUEST_KINDS: GenerationRequestKind[] = ["generate", "retry", "continue"]

interface GenerateBody {
  context: ComposedContext
  settings: GenerationSettings
  storyId?: string
  requestKind?: GenerationRequestKind
}

/**
 * The story this call is billed to, or null.
 *
 * A body naming a story that is not there still streams: the writer asked for
 * prose and a bookkeeping miss is not their problem. It is recorded with a null
 * story_id rather than rejected, because a cost is a cost — the global view is
 * built to read those rows.
 */
async function resolveStory(
  storyId: string | undefined
): Promise<{ id: string; title: string } | null> {
  if (!storyId) return null
  try {
    const db = await getDb()
    const row = await db
      .select({ id: stories.id, title: stories.title })
      .from(stories)
      .where(eq(stories.id, storyId))
      .limit(1)
      .then((rows) => rows[0])
    return row ?? null
  } catch {
    return null
  }
}

/**
 * Hands post-response work to Next's `after`, or lets it run on its own.
 *
 * Both writes below are already in flight by the time they get here — they are
 * promises, not thunks — so the only thing `after` adds is keeping the request
 * alive until they finish. If it is not callable (a stream callback that has
 * lost the request scope), losing that guarantee is far better than throwing
 * out of a `finally` on a response that has already been sent.
 */
function schedule(work: Promise<void>): void {
  const swallow = work.catch(() => {})
  try {
    after(swallow)
  } catch {
    void swallow
  }
}

export async function POST(req: Request): Promise<Response> {
  const key = resolveOpenRouterKey()
  if (!key) {
    return Response.json(
      { error: "OPENROUTER_API_KEY is not configured." },
      { status: 503 }
    )
  }

  let body: GenerateBody
  try {
    body = await req.json()
    if (!body?.context || !body?.settings?.modelId) throw new Error("bad body")
  } catch {
    return Response.json(
      { error: "Malformed generation request." },
      {
        status: 400,
      }
    )
  }

  const upstream = new AbortController()
  // Client disconnect (Stop button, tab close) aborts the OpenRouter request.
  req.signal.addEventListener("abort", () => upstream.abort(), { once: true })

  const gen = streamCompletion({
    context: body.context,
    settings: body.settings,
    key,
    signal: upstream.signal,
  })

  // Pull the first event BEFORE building the Response so auth/credit/rate
  // errors still surface as JSON with a proper status code.
  let first: IteratorResult<GenerationEvent>
  try {
    first = await gen.next()
  } catch (err) {
    const { status, message } = mapOpenRouterError(err)
    return Response.json({ error: message }, { status })
  }

  // Only now: everything above could still have answered with a status, and a
  // request that never reached a provider was never billed.
  const story = await resolveStory(body.storyId)
  const callId = crypto.randomUUID()
  await recordCallStarted({
    id: callId,
    storyId: story?.id ?? null,
    origStoryId: body.storyId ?? null,
    storyTitle: story?.title ?? null,
    requestKind:
      body.requestKind && REQUEST_KINDS.includes(body.requestKind)
        ? body.requestKind
        : "generate",
    modelId: body.settings.modelId,
    thinking: body.settings.thinking ?? null,
    providerName: body.settings.providerTag ?? null,
  })

  const encoder = new TextEncoder()
  // One JSON object per line. The trailing newline is the frame delimiter, so
  // it is what lets the client split a read that landed mid-object — network
  // reads do not respect our record boundaries and a half-written `{"type":"te`
  // has to be held, not parsed.
  const line = (event: GenerationEvent) =>
    encoder.encode(JSON.stringify(event) + "\n")

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Aborted is the default, not the exception. A Stop does not throw
      // anywhere: streamCompletion RETURNS the moment its signal trips, so the
      // `for await` below ends exactly as a finished generation does. Only the
      // signal itself tells the two apart, and every path that does not prove
      // otherwise is a call that was cut short.
      let status: SettledCallStatus = "aborted"
      let generationId: string | null = null
      let usage: GenerationUsage | null = null

      // The provider does not know the ledger exists, so the callId is stamped
      // onto its meta event on the way past. The client needs it to link the
      // passage it is about to persist back to this row.
      const forward = (event: GenerationEvent) => {
        if (event.type === "meta") {
          generationId = event.generationId
          controller.enqueue(line({ ...event, callId }))
          return
        }
        if (event.type === "usage") usage = event.usage
        controller.enqueue(line(event))
      }

      try {
        if (!first.done) forward(first.value)
        for await (const event of gen) forward(event)
        // Decided before the close, because a cancelled stream makes close()
        // itself throw and that must not be read as a provider error.
        status = upstream.signal.aborted ? "aborted" : "ok"
        controller.close()
      } catch (err) {
        if (upstream.signal.aborted) {
          // The writer pressed Stop while a chunk was in flight. Tokens were
          // billed; nothing failed.
          status = "aborted"
        } else {
          // Mid-stream failure: headers are gone; error the stream. The client
          // keeps the partial text (same semantics as Stop) and shows a toast.
          status = "error"
          controller.error(new Error(mapOpenRouterError(err).message))
        }
      } finally {
        // `after` runs once the response has finished streaming, inside this
        // request's lifetime — so neither write is in front of a token. If it
        // is unavailable (no request scope), the work still runs: settling the
        // ledger matters more than settling it at the tidiest moment.
        schedule(settleCall(callId, { status, generationId, usage }))
        // Only for a call that never finished: a completed one already told us
        // its cost on the final chunk, and asking again would buy nothing.
        if (shouldReconcile(status, generationId)) {
          schedule(reconcileCall(callId, generationId, key))
        }
      }
    },
    cancel() {
      // Abort only. It makes the `for await` above return, which lands in the
      // same `finally` — so there is exactly one settle path, and a client
      // disconnect cannot record a second row or skip the first.
      upstream.abort()
    },
  })

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
    },
  })
}
