// lib/generation/openrouter-provider.ts — Client half of the real provider.
// Same GenerationProvider contract as the mock; the key never comes here —
// generation goes through POST /api/generate. No @openrouter/sdk import in
// this file (it must stay client-safe).
import type {
  GenerationEvent,
  GenerationProvider,
  GenerationRequest,
} from "./types"

export class OpenRouterProvider implements GenerationProvider {
  async *generate(request: GenerationRequest): AsyncGenerator<GenerationEvent> {
    const { context, settings, signal } = request
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ context, settings }),
      signal,
    })

    if (!res.ok) {
      const payload: { error?: string } | null = await res
        .json()
        .catch(() => null)
      throw new Error(payload?.error ?? "Generation failed. Try again.")
    }
    if (!res.body) return

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    // Holds the tail of a read that stopped mid-line. A network read boundary
    // has nothing to do with our record boundary, so the last line of any read
    // is only complete if the read happened to end on a newline — parsing it
    // eagerly is how a passage loses a chunk of prose to a JSON error.
    let buffer = ""

    try {
      while (true) {
        if (signal?.aborted) return
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        let newline: number
        while ((newline = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, newline)
          buffer = buffer.slice(newline + 1)
          const event = parseEvent(line)
          if (event) yield event
        }
      }

      // A stream that ended without a final newline still has a whole record in
      // the buffer; dropping it would silently lose the usage event, which is
      // always last.
      const event = parseEvent(buffer)
      if (event) yield event
    } finally {
      // Breaking out (abort/Stop) cancels the response body, which cancels
      // the route's ReadableStream, which aborts the OpenRouter request.
      reader.cancel().catch(() => {})
    }
  }
}

/**
 * One NDJSON line to an event. Blank lines are the ordinary result of a trailing
 * delimiter, not an error. A line that does not parse is dropped rather than
 * thrown: the writer's half-finished passage is worth more than strictness about
 * a frame we could not read, and Stop already has the same "keep the partial
 * text" semantics.
 */
function parseEvent(line: string): GenerationEvent | null {
  const trimmed = line.trim()
  if (trimmed === "") return null
  try {
    return JSON.parse(trimmed) as GenerationEvent
  } catch {
    return null
  }
}
