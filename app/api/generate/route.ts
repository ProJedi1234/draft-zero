// POST /api/generate — server-side streaming proxy. The only place the
// OpenRouter key and the SDK meet a request. NDJSON chunked response — one
// GenerationEvent per line — because the stream now carries three kinds of
// thing (reasoning ticks, prose, final usage) and bare text could only carry
// one. Pre-stream failures answer JSON { error } with a real status.
import { resolveOpenRouterKey } from "@/lib/generation/key"
import {
  mapOpenRouterError,
  streamCompletion,
} from "@/lib/generation/openrouter"
import type { ComposedContext, GenerationEvent } from "@/lib/generation/types"
import type { GenerationSettings } from "@/lib/types"

export async function POST(req: Request): Promise<Response> {
  const key = resolveOpenRouterKey()
  if (!key) {
    return Response.json(
      { error: "OPENROUTER_API_KEY is not configured." },
      { status: 503 }
    )
  }

  let body: { context: ComposedContext; settings: GenerationSettings }
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

  const gen = streamCompletion({ ...body, key, signal: upstream.signal })

  // Pull the first event BEFORE building the Response so auth/credit/rate
  // errors still surface as JSON with a proper status code.
  let first: IteratorResult<GenerationEvent>
  try {
    first = await gen.next()
  } catch (err) {
    const { status, message } = mapOpenRouterError(err)
    return Response.json({ error: message }, { status })
  }

  const encoder = new TextEncoder()
  // One JSON object per line. The trailing newline is the frame delimiter, so
  // it is what lets the client split a read that landed mid-object — network
  // reads do not respect our record boundaries and a half-written `{"type":"te`
  // has to be held, not parsed.
  const line = (event: GenerationEvent) =>
    encoder.encode(JSON.stringify(event) + "\n")

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        if (!first.done) controller.enqueue(line(first.value))
        for await (const event of gen) controller.enqueue(line(event))
        controller.close()
      } catch (err) {
        // Mid-stream failure: headers are gone; error the stream. The client
        // keeps the partial text (same semantics as Stop) and shows a toast.
        controller.error(new Error(mapOpenRouterError(err).message))
      }
    },
    cancel() {
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
