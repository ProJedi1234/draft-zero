// lib/generation/models.ts — Live OpenRouter model catalog, server-only.
// Server components fetch the list per request; a module-level TTL cache keeps
// that cheap. MOCK_MODELS remains the fallback so the picker is never empty.
import "server-only"

import { OpenRouter } from "@openrouter/sdk"
import type { Model } from "@openrouter/sdk/models"

import { MOCK_MODELS } from "@/lib/mock-data"
import {
  REASONING_EFFORTS,
  type ModelReasoning,
  type OpenRouterModel,
  type ReasoningEffort,
} from "@/lib/types"

import { resolveOpenRouterKey } from "./key"

const TTL_MS = 60 * 60 * 1000
let cache: { at: number; data: OpenRouterModel[] } | null = null

/** "$/token string" from OpenRouter → display "$/1M tokens" string. */
function per1M(perToken: string | undefined): string {
  const n = Number(perToken)
  if (!Number.isFinite(n) || n <= 0) return "$0.00"
  return `$${(n * 1_000_000).toFixed(2)}`
}

function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return REASONING_EFFORTS.includes(value as ReasoningEffort)
}

/**
 * Reasoning support for one catalog entry, or null when the model can't think.
 *
 * OpenRouter omits `reasoning` for non-reasoning models, but dynamic routers
 * advertise the parameter without the block — those get the full effort ladder.
 * `supportedEfforts` arrives highest-first and may include "none" (which is
 * this app's "off", not a level), so it is filtered back into our own order.
 */
function toReasoning(m: Model): ModelReasoning | null {
  const advertised = m.supportedParameters.some(
    (p) => p === "reasoning" || p === "reasoning_effort"
  )
  if (!m.reasoning)
    return advertised
      ? { efforts: [...REASONING_EFFORTS], mandatory: false }
      : null

  const allowed = m.reasoning.supportedEfforts?.filter(isReasoningEffort) ?? []
  const efforts = REASONING_EFFORTS.filter(
    (e) => allowed.length === 0 || allowed.includes(e)
  )
  return {
    efforts: efforts.length > 0 ? efforts : [...REASONING_EFFORTS],
    mandatory: m.reasoning.mandatory,
  }
}

function toDomainModel(m: Model): OpenRouterModel {
  // OpenRouter names are "Provider: Model Name" — split for grouping. Not all
  // of them: entries named without the colon fall back to the id's author, and
  // a router alias ("~anthropic/claude-sonnet-latest") carries a "~" there that
  // belongs to the id, not to the lab's name.
  const [provider, ...rest] = m.name.split(": ")
  return {
    id: m.id,
    name: rest.length > 0 ? rest.join(": ") : m.name,
    provider: rest.length > 0 ? provider : m.id.split("/")[0].replace(/^~/, ""),
    contextLength: m.contextLength ?? 0,
    pricing: {
      prompt: per1M(m.pricing.prompt),
      completion: per1M(m.pricing.completion),
    },
    reasoning: toReasoning(m),
    ...(m.aliasTarget ? { aliasTarget: m.aliasTarget.slug } : {}),
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
