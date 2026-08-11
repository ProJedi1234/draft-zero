// lib/generation/openrouter-provider.ts — Client half of the real provider.
// Same GenerationProvider contract as the mock; the key never comes here —
// generation goes through POST /api/generate, key checks through a server
// action. No @openrouter/sdk import in this file (it must stay client-safe).
import { verifyOpenRouterKey } from "@/lib/actions/settings"

import type { GenerationProvider, GenerationRequest } from "./types"

export class OpenRouterProvider implements GenerationProvider {
  async *generate(request: GenerationRequest): AsyncGenerator<string> {
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
    try {
      while (true) {
        if (signal?.aborted) return
        const { done, value } = await reader.read()
        if (done) break
        const text = decoder.decode(value, { stream: true })
        if (text !== "") yield text
      }
    } finally {
      // Breaking out (abort/Stop) cancels the response body, which cancels
      // the route's ReadableStream, which aborts the OpenRouter request.
      reader.cancel().catch(() => {})
    }
  }

  async verifyKey(key: string): Promise<{ ok: boolean; message: string }> {
    return verifyOpenRouterKey(key)
  }
}
