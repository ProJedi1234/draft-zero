// lib/generation/key.ts — Server-side OpenRouter key resolution.
// Single shared deploy: the key always comes from the environment, never
// per-user. Never import from a client component: "server-only" enforces
// it at build time.
import "server-only"

import { isLocalModelId } from "@/lib/types"

/** Resolved key, or null when OpenRouter is unconfigured (→ mock provider). */
export function resolveOpenRouterKey(): string | null {
  const env = process.env.OPENROUTER_API_KEY?.trim()
  return env ? env : null
}

/**
 * The key a call to `modelId` runs under, or null for the offline mock. A
 * local model needs no key, so it gets "" and never falls back to the mock:
 * an unreachable host has to fail as itself.
 */
export function resolveKeyForModel(modelId: string): string | null {
  return isLocalModelId(modelId) ? "" : resolveOpenRouterKey()
}
