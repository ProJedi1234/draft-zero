// lib/generation/key.ts — Server-side OpenRouter key resolution.
// Single shared deploy: the key always comes from the environment, never
// per-user. Never import from a client component: "server-only" enforces
// it at build time.
import "server-only"

/** Resolved key, or null when OpenRouter is unconfigured (→ mock provider). */
export function resolveOpenRouterKey(): string | null {
  const env = process.env.OPENROUTER_API_KEY?.trim()
  return env ? env : null
}
