// lib/generation/zdr.ts — What OpenRouter will and won't retain, server-only.
//
// Two questions, one module. Which endpoints keep nothing (a list OpenRouter
// publishes, cached here like the model and endpoint catalogs beside it), and
// whether the ACCOUNT already forces every request through them — which
// OpenRouter publishes nowhere, and which this module therefore has to find out
// by asking.
import "server-only"

import { OpenRouterCore } from "@openrouter/sdk/core.js"
import { chatSend } from "@openrouter/sdk/funcs/chatSend.js"
import { endpointsListZdrEndpoints } from "@openrouter/sdk/funcs/endpointsListZdrEndpoints.js"
import { OpenRouterError } from "@openrouter/sdk/models/errors"

import type { AccountZdrPolicy, OpenRouterModel } from "@/lib/types"

import { resolveOpenRouterKey } from "./key"
import { listModels } from "./models"

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

let accountCache: { at: number; data: AccountZdrPolicy } | null = null

/**
 * True for the 404 OpenRouter returns when a data policy left it nowhere to
 * route a request. Zero data retention is one such policy; an account that
 * refuses providers which train on prompts is another, and the two are not
 * distinguishable by message — which is the whole reason accountZdrPolicy()
 * below has to sample rather than read one answer.
 */
export function isDataPolicyRefusal(err: unknown): boolean {
  if (!(err instanceof OpenRouterError)) return false
  if (err.statusCode !== 404) return false
  return /data polic/i.test(err.body) || /data polic/i.test(err.message)
}

/**
 * Forgets the cached account policy, so the next read probes again.
 *
 * Called when a real generation is refused on data-policy grounds without this
 * app having asked for anything — the cached answer just contradicted reality,
 * and the probe, not the failure, is what gets to say what replaced it.
 */
export function invalidateAccountZdrPolicy(): void {
  accountCache = null
}

/** How many free models the probe is willing to spend a token on before giving up. */
const PROBE_LIMIT = 5

/**
 * Free models with no ZDR endpoint at all, at most one per author.
 *
 * Free is the condition for probing rather than an optimisation: a paid probe
 * would spend the writer's credit to answer a question about a checkbox. The
 * one-per-author spread is what keeps the sample honest — an account that
 * merely refuses providers who train on prompts would refuse a whole author's
 * free tier at once, and five models from one author would read as five votes
 * when they are one.
 *
 * Exported for the test that pins that spread; nothing else calls it.
 */
export function probeModels(models: OpenRouterModel[]): OpenRouterModel[] {
  const authors = new Set<string>()
  const picked: OpenRouterModel[] = []
  for (const model of [...models].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!model.id.endsWith(":free")) continue
    if (model.id.startsWith("~") || model.zdr) continue
    const author = model.id.split("/")[0]
    if (authors.has(author)) continue
    authors.add(author)
    picked.push(model)
    if (picked.length === PROBE_LIMIT) break
  }
  return picked
}

/** One token from one free model: served, refused on data-policy grounds, or neither. */
async function probe(
  core: OpenRouterCore,
  modelId: string
): Promise<"served" | "refused" | "inconclusive"> {
  try {
    const res = await chatSend(core, {
      chatRequest: {
        model: modelId,
        // A single token of a single character: the answer is in the routing,
        // and nothing here reads the completion.
        messages: [{ role: "user", content: "." }],
        maxTokens: 1,
      },
    })
    if (res.ok) return "served"
    return isDataPolicyRefusal(res.error) ? "refused" : "inconclusive"
  } catch (err) {
    return isDataPolicyRefusal(err) ? "refused" : "inconclusive"
  }
}

/**
 * Whether the account enforces zero data retention, cached an hour per server
 * process.
 *
 * There is no API for this. `/key` does not carry it, the guardrails API needs
 * a management key this app does not hold, and `/models/user` is filtered by
 * unrelated account settings too — so the only way to learn it is to ask for
 * something an enforcing account must refuse: a model no ZDR endpoint serves.
 *
 * One answer settles it. A model that retains prompts being SERVED proves the
 * account does not enforce retention-free routing, and the probe stops there.
 * Refusals prove less on their own, because a data policy about training refuses
 * models too — so it takes every sampled author refusing, and the sample is
 * spread across authors precisely so that agreement means something. Anything
 * else (a rate limit, a provider outage, a catalog with no free model left in
 * it) is "unknown", which locks nothing and lets the writer decide for
 * themselves.
 */
export async function accountZdrPolicy(): Promise<AccountZdrPolicy> {
  if (accountCache && Date.now() - accountCache.at < TTL_MS) {
    return accountCache.data
  }
  const key = resolveOpenRouterKey()
  if (!key) return "unknown"

  const candidates = probeModels(await listModels())
  const core = new OpenRouterCore({ apiKey: key, appTitle: "draft-zero" })

  let refused = 0
  let policy: AccountZdrPolicy = "unknown"
  for (const model of candidates) {
    const result = await probe(core, model.id)
    if (result === "served") {
      policy = "not-enforced"
      break
    }
    if (result === "refused") refused += 1
  }
  // Every author asked, every author refused. Nothing else this app can see
  // explains that, and a writer whose account is locked down is exactly the
  // writer this feature exists for.
  if (policy === "unknown" && refused > 0 && refused === candidates.length) {
    policy = "enforced"
  }

  // "unknown" is cached too, and deliberately: a rate-limited free tier stays
  // rate limited, and retrying on every render would turn a few wasted requests
  // into a stream of them.
  accountCache = { at: Date.now(), data: policy }
  return policy
}
