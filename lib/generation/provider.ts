// lib/generation/provider.ts — The single place the app resolves a provider.
//
// The kind is decided server-side (key present?) in prepareGeneration and
// delivered to the hook in the prepared payload — the client never sees the
// key. Both implementations are client-safe imports, so this module stays
// valid in the browser bundle; the OpenRouter one talks to /api/generate.

import { MockGenerationProvider } from "./mock-provider"
import { OpenRouterProvider } from "./openrouter-provider"
import type { GenerationProvider } from "./types"

export type ProviderKind = "mock" | "openrouter"

const providers: Partial<Record<ProviderKind, GenerationProvider>> = {}

/** Module singletons per kind. Defaults to the offline mock. */
export function getGenerationProvider(
  kind: ProviderKind = "mock"
): GenerationProvider {
  return (providers[kind] ??=
    kind === "openrouter"
      ? new OpenRouterProvider()
      : new MockGenerationProvider())
}
