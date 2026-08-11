// lib/generation/models.ts — Live OpenRouter model catalog, server-only.
// Server components fetch the list per request; a module-level TTL cache keeps
// that cheap. MOCK_MODELS remains the fallback so the picker is never empty.
import "server-only"

import { OpenRouter } from "@openrouter/sdk"
import type { Model } from "@openrouter/sdk/models"

import { MOCK_MODELS } from "@/lib/mock-data"
import type { OpenRouterModel } from "@/lib/types"

import { resolveOpenRouterKey } from "./key"

const TTL_MS = 60 * 60 * 1000
let cache: { at: number; data: OpenRouterModel[] } | null = null

/** "$/token string" from OpenRouter → display "$/1M tokens" string. */
function per1M(perToken: string | undefined): string {
  const n = Number(perToken)
  if (!Number.isFinite(n) || n <= 0) return "$0.00"
  return `$${(n * 1_000_000).toFixed(2)}`
}

function toDomainModel(m: Model): OpenRouterModel {
  // OpenRouter names are "Provider: Model Name" — split for grouping.
  const [provider, ...rest] = m.name.split(": ")
  return {
    id: m.id,
    name: rest.length > 0 ? rest.join(": ") : m.name,
    provider: rest.length > 0 ? provider : m.id.split("/")[0],
    contextLength: m.contextLength ?? 0,
    pricing: {
      prompt: per1M(m.pricing.prompt),
      completion: per1M(m.pricing.completion),
    },
  }
}

/**
 * Live OpenRouter catalog mapped to the domain OpenRouterModel, cached 1h
 * per server process. Falls back to MOCK_MODELS when unconfigured or the
 * fetch fails — the picker must never be empty.
 */
export async function listModels(): Promise<OpenRouterModel[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data
  const key = resolveOpenRouterKey()
  if (!key) return MOCK_MODELS
  try {
    const client = new OpenRouter({ apiKey: key, appTitle: "draft-zero" })
    const page = await client.models.list()
    const data = page.result.data
      .filter((m) => m.architecture.outputModalities.includes("text"))
      .map(toDomainModel)
      .sort(
        (a, b) =>
          a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name)
      )
    if (data.length === 0) return MOCK_MODELS
    cache = { at: Date.now(), data }
    return data
  } catch {
    return MOCK_MODELS
  }
}
