// POST /api/generate — server-side streaming proxy. The only place the
// OpenRouter key and the SDK meet a request. Plain-text chunked response;
// pre-stream failures answer JSON { error } with a real status.
import { resolveOpenRouterKey } from "@/lib/generation/key"
import {
  mapOpenRouterError,
  streamCompletion,
} from "@/lib/generation/openrouter"
import type { ComposedContext } from "@/lib/generation/types"
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

  // Pull the first chunk BEFORE building the Response so auth/credit/rate
  // errors still surface as JSON with a proper status code.
  let first: IteratorResult<string>
  try {
    first = await gen.next()
  } catch (err) {
    const { status, message } = mapOpenRouterError(err)
    return Response.json({ error: message }, { status })
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        if (!first.done) controller.enqueue(encoder.encode(first.value))
        for await (const chunk of gen) controller.enqueue(encoder.encode(chunk))
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
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  })
}
