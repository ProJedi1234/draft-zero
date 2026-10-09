// lib/generation/decision-models.ts — Every System One decision model this app
// can call, server-only: OpenRouter's, then whatever is installed on the local
// Ollama host. A separate catalog from models.ts because decision models are
// absent from OpenRouter's default (text-output) model list altogether.
import "server-only"

import type { DecisionModel } from "@/lib/types"

import { DEFAULT_ATMOSPHERE_DECISION_MODEL_ID } from "./atmosphere-decision"
import { resolveOpenRouterKey } from "./key"
import { listOllamaDecisionModels } from "./ollama"
import { zdrModelSlugs } from "./zdr"

const ENDPOINT =
  "https://openrouter.ai/api/v1/models?output_modalities=decisions"
const TTL_MS = 60 * 60 * 1000
/** Settings waits on this list, so a stalled OpenRouter falls back instead. */
const FETCH_TIMEOUT_MS = 5_000

/** What the picker offers when OpenRouter can't be asked: the default alone. */
const FALLBACK: DecisionModel[] = [
  {
    id: DEFAULT_ATMOSPHERE_DECISION_MODEL_ID,
    name: "Jev 1.13",
    provider: "TypeSafe",
    contextLength: 64_000,
    promptPrice: "$0.042",
    inputModalities: ["text"],
    zdr: false,
  },
]

interface RawDecisionModel {
  id: string
  name: string
  context_length?: number | null
  pricing?: { prompt?: string }
  architecture?: { input_modalities?: string[] }
  alias_target?: { slug: string } | null
}

let cache: { at: number; data: DecisionModel[] } | null = null

/**
 * Decision prices are fractions of a cent per million tokens, so two decimals
 * would print most of them as $0.04 or $0.00.
 */
function promptPrice(perToken: string | undefined): string {
  const n = Number(perToken) * 1_000_000
  if (!Number.isFinite(n) || n <= 0) return "$0.00"
  return `$${Number(n.toFixed(n < 1 ? 3 : 2))}`
}

function toDecisionModel(
  m: RawDecisionModel,
  zdrSlugs: Set<string>
): DecisionModel {
  // Same "Lab: Model" split as the text catalog.
  const [lab, ...rest] = m.name.split(": ")
  return {
    id: m.id,
    name: rest.length > 0 ? rest.join(": ") : m.name,
    provider: rest.length > 0 ? lab : m.id.split("/")[0].replace(/^~/, ""),
    contextLength: m.context_length ?? 0,
    promptPrice: promptPrice(m.pricing?.prompt),
    inputModalities: m.architecture?.input_modalities ?? ["text"],
    zdr: zdrSlugs.has(m.alias_target?.slug ?? m.id),
  }
}

async function listOpenRouterDecisionModels(): Promise<DecisionModel[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data
  const key = resolveOpenRouterKey()
  if (!key) return FALLBACK
  try {
    const [res, zdrSlugs] = await Promise.all([
      fetch(ENDPOINT, {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      }),
      zdrModelSlugs(),
    ])
    if (!res.ok) return FALLBACK
    const body = (await res.json()) as { data?: RawDecisionModel[] }
    const data = (body.data ?? [])
      .map((m) => toDecisionModel(m, zdrSlugs))
      .sort(
        (a, b) =>
          a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name)
      )
    if (data.length === 0) return FALLBACK
    cache = { at: Date.now(), data }
    return data
  } catch {
    return FALLBACK
  }
}

/** Local decision models first, then OpenRouter's, grouped by lab. */
export async function listDecisionModels(): Promise<DecisionModel[]> {
  const [local, remote] = await Promise.all([
    listOllamaDecisionModels(),
    listOpenRouterDecisionModels(),
  ])
  return [...local, ...remote]
}
