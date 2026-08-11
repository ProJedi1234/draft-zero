// lib/generation/key.ts — Server-side OpenRouter key resolution.
// Env var wins (deploys/CI); the settings-page key is the fallback.
// Never import from a client component: "server-only" enforces it at build time.
import "server-only"

import { getAppSettings } from "@/lib/db/queries"

/** Resolved key, or null when OpenRouter is unconfigured (→ mock provider). */
export async function resolveOpenRouterKey(): Promise<string | null> {
  const env = process.env.OPENROUTER_API_KEY?.trim()
  if (env) return env
  const settings = await getAppSettings()
  const stored = settings.openRouterKey.trim()
  return stored === "" ? null : stored
}
