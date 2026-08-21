// lib/generation/zdr.ts — Which endpoints keep nothing, server-only.
//
// A catalog, cached like the model and endpoint catalogs beside it, and
// deliberately the leaf of the three: endpoints.ts and models.ts both join
// against it, so it must not import either of them back. The other half of the
// subject — whether the ACCOUNT already forces every request through these
// endpoints — lives in zdr-account.ts, which is free to import everything.
import "server-only"

import { OpenRouterCore } from "@openrouter/sdk/core.js"
import { endpointsListZdrEndpoints } from "@openrouter/sdk/funcs/endpointsListZdrEndpoints.js"

import { resolveOpenRouterKey } from "./key"

/**
 * An hour, matching the model catalog rather than the five minutes the endpoint
 * list uses: which endpoints exist and how fast they are today is volatile, but
 * whether a provider retains prompts is a contract, and contracts do not change
 * between two continuations.
 */
const TTL_MS = 60 * 60 * 1000

let tagCache: { at: number; data: Map<string, Set<string>> } | null = null

/**
 * model id → the tags of its endpoints that retain nothing, from OpenRouter's
 * global ZDR list (`GET /endpoints/zdr`). One request for every model, which is
 * why it is fetched whole and cached rather than asked per model.
 *
 * An empty map is what a caller gets when OpenRouter is unconfigured or the
 * fetch fails, and every endpoint then reads as non-ZDR. That is the safe
 * direction: the picker greys rows out and the writer sees that something is
 * missing, where the opposite default would quietly promise retention-free
 * routing this app could not verify.
 */
async function zdrTagsByModel(): Promise<Map<string, Set<string>>> {
  if (tagCache && Date.now() - tagCache.at < TTL_MS) return tagCache.data

  const key = resolveOpenRouterKey()
  if (!key) return new Map()
  try {
    const core = new OpenRouterCore({ apiKey: key, appTitle: "draft-zero" })
    const res = await endpointsListZdrEndpoints(core)
    if (!res.ok) return new Map()
    const data = new Map<string, Set<string>>()
    for (const endpoint of res.value.data) {
      const tags = data.get(endpoint.modelId)
      if (tags) tags.add(endpoint.tag)
      else data.set(endpoint.modelId, new Set([endpoint.tag]))
    }
    tagCache = { at: Date.now(), data }
    return data
  } catch {
    return new Map()
  }
}

/**
 * The endpoint tags of `modelId` that retain nothing. `modelId` must already be
 * the concrete model — a "~lab/family-latest" alias serves nothing itself, so
 * the caller resolves it first, exactly as it does for the endpoint list.
 */
export async function zdrTagsForModel(modelId: string): Promise<Set<string>> {
  return (await zdrTagsByModel()).get(modelId) ?? new Set()
}

/**
 * Every model id with at least one endpoint that retains nothing.
 *
 * Concrete ids only — router aliases are absent, because OpenRouter lists
 * endpoints under the model that actually serves them. listModels() is what
 * folds an alias in through its target; doing it here would mean asking the
 * catalog for the catalog.
 */
export async function zdrModelSlugs(): Promise<Set<string>> {
  return new Set((await zdrTagsByModel()).keys())
}
