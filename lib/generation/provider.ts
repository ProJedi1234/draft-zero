// lib/generation/provider.ts — The single place the app resolves a provider.
//
// SWAP POINT: when a real OpenRouter provider lands, it implements the same
// GenerationProvider interface (client-side fetch with the stored key, or behind
// a route handler — the interface does not care) and is returned from here.
// Nothing else in the app changes. In this milestone the mock is the only
// implementation, and it makes no network calls of any kind.

import { MockGenerationProvider } from "./mock-provider"
import type { GenerationProvider } from "./types"

let provider: GenerationProvider | null = null

/** Module singleton. Today always the mock; the OpenRouter swap point later. */
export function getGenerationProvider(): GenerationProvider {
  if (provider === null) provider = new MockGenerationProvider()
  return provider
}
