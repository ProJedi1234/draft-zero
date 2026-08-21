// lib/generation/endpoints.ts — Live OpenRouter endpoint list for one model,
// server-only. Sibling of models.ts: same TTL-cache-and-fall-back-to-mock shape,
// keyed per model instead of once globally, and with a much shorter TTL because
// throughput is a rolling 30-minute measurement — an hour-old "tps" figure is
// not the number the writer would be routed against.
import "server-only"

import { OpenRouterCore } from "@openrouter/sdk/core.js"
import { endpointsList } from "@openrouter/sdk/funcs/endpointsList.js"
import type { PublicEndpoint } from "@openrouter/sdk/models"

import { mockEndpoints } from "@/lib/mock-data"
import type { ModelEndpoint } from "@/lib/types"

import { resolveOpenRouterKey } from "./key"
import { listModels } from "./models"
import { zdrTagsForModel } from "./zdr"

const TTL_MS = 5 * 60 * 1000
const cache = new Map<string, { at: number; data: ModelEndpoint[] }>()

/** "$/token string" from OpenRouter → display "$/1M tokens" string. */
function per1M(perToken: string | undefined): string {
  const n = Number(perToken)
  if (!Number.isFinite(n) || n <= 0) return "$0.00"
  return `$${(n * 1_000_000).toFixed(2)}`
}

function toDomainEndpoint(
  e: PublicEndpoint,
  zdrTags: Set<string>
): ModelEndpoint {
  return {
    tag: e.tag,
    providerName: e.providerName,
    contextLength: e.contextLength,
    pricing: {
      prompt: per1M(e.pricing.prompt),
      completion: per1M(e.pricing.completion),
    },
    // p50, not p90: the median is what a continuation will actually feel like.
    throughput: e.throughputLast30m?.p50 ?? null,
    uptime: e.uptimeLast1d ?? null,
    // OpenRouter says "unknown" when the provider hasn't declared its weights;
    // that is the same information as no answer, so it is not printed.
    quantization:
      e.quantization && e.quantization !== "unknown" ? e.quantization : null,
    // Membership of OpenRouter's ZDR list, not anything the endpoint says about
    // itself: the endpoints API carries no retention field, and two tags of the
    // same provider ("xai" and "xai/zdr") answer this differently.
    zdr: zdrTags.has(e.tag),
  }
}

/** Fastest first, unmeasured endpoints last — the picker renders this order as-is. */
function byThroughputDesc(a: ModelEndpoint, b: ModelEndpoint): number {
  if (a.throughput === null && b.throughput === null)
    return a.providerName.localeCompare(b.providerName)
  if (a.throughput === null) return 1
  if (b.throughput === null) return -1
  return b.throughput - a.throughput
}

/**
 * The concrete model id behind `modelId`: itself for an ordinary model, the
 * alias target for a router alias. Unknown ids come back unchanged — the caller
 * asks OpenRouter and falls back on its answer either way.
 */
async function resolveAlias(modelId: string): Promise<string> {
  if (!modelId.startsWith("~")) return modelId
  const model = (await listModels()).find((m) => m.id === modelId)
  return model?.aliasTarget ?? modelId
}

/**
 * Mock list for `modelId`, or [] when even the model is unknown to the catalog.
 * Sorted here rather than in the fixture so both paths out of this module honour
 * the same "fastest first" promise.
 */
async function fallbackEndpoints(modelId: string): Promise<ModelEndpoint[]> {
  const model = (await listModels()).find((m) => m.id === modelId)
  return model ? mockEndpoints(model).sort(byThroughputDesc) : []
}

/**
 * Every upstream endpoint serving `modelId`, fastest first, cached five minutes
 * per model per server process. Falls back to the deterministic mock list when
 * OpenRouter is unconfigured or the fetch fails — the picker must always be able
 * to offer Auto plus something, the same rule listModels() follows.
 *
 * `modelId` is "author/slug"; anything else (a hand-edited row, a bare slug)
 * cannot be looked up and comes back as the mock list.
 */
export async function listModelEndpoints(
  modelId: string
): Promise<ModelEndpoint[]> {
  const hit = cache.get(modelId)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data

  const key = resolveOpenRouterKey()
  // A "~lab/family-latest" alias has no endpoints of its own — it is a router,
  // and asking for its endpoints truthfully returns none. What serves a request
  // against it is whatever currently sits behind it, so the alias is resolved to
  // that target first and its endpoints are the ones offered. They are also the
  // ones a pin lands on: `provider.only` applies after the redirect, verified
  // against the live API. When the alias later moves to a new model, a tag that
  // the new target does not serve falls back to Auto through endpointForTag,
  // which is the intended cost of pinning a moving model.
  const resolvedId = await resolveAlias(modelId)
  const [author, ...rest] = resolvedId.split("/")
  const slug = rest.join("/")
  if (!key || !author || !slug) return fallbackEndpoints(modelId)

  try {
    const core = new OpenRouterCore({ apiKey: key, appTitle: "draft-zero" })
    // Both cached, and the ZDR list is one fetch for the whole catalog, so the
    // second half of this pair is free after the first model of the session.
    const [res, zdrTags] = await Promise.all([
      endpointsList(core, { author, slug }),
      zdrTagsForModel(resolvedId),
    ])
    if (!res.ok) return fallbackEndpoints(modelId)
    const data = res.value.data.endpoints
      // OpenRouter reports 0 for a healthy endpoint and a negative status for one
      // it has deranked or disabled. Offering those as a pin would hand the
      // writer a menu entry that fails on send, so they are dropped here — Auto
      // still routes through whatever OpenRouter is willing to use.
      .filter((e) => (e.status ?? 0) >= 0)
      .map((e) => toDomainEndpoint(e, zdrTags))
      .sort(byThroughputDesc)
    // An answered request with no endpoints is an answer, not a failure. Router
    // models — the "~anthropic/claude-sonnet-latest" aliases that redirect to
    // whatever is current — serve nothing themselves, so OpenRouter truthfully
    // reports zero. Substituting the mock list here is what put Cerebras and
    // Fireworks under Claude; [] is correct and the picker hides itself for it.
    cache.set(modelId, { at: Date.now(), data })
    return data
  } catch {
    return fallbackEndpoints(modelId)
  }
}
