// lib/generation/zdr-account.ts — What the OpenRouter ACCOUNT already
// enforces, server-only.
//
// Per group, because that is how OpenRouter's privacy settings work: five
// zero-data-retention toggles, one each for Anthropic, OpenAI, Google, xAI and
// everything else. An account with Anthropic and OpenAI locked down while
// Google and xAI stay open is an ordinary account, and a single boolean answer
// about it is wrong for three of the five groups.
import "server-only"

import { OpenRouterCore } from "@openrouter/sdk/core.js"
import { chatSend } from "@openrouter/sdk/funcs/chatSend.js"
import { OpenRouterError } from "@openrouter/sdk/models/errors"

import {
  ZDR_GROUPS,
  zdrGroupForModel,
  type AccountZdrPolicies,
  type AccountZdrPolicy,
  type ModelEndpoint,
  type OpenRouterModel,
  type ZdrGroup,
} from "@/lib/types"

import { listModelEndpoints } from "./endpoints"
import { resolveOpenRouterKey } from "./key"
import { listModels } from "./models"

/** An hour, matching the catalogs beside it: a retention contract is not a per-turn fact. */
const TTL_MS = 60 * 60 * 1000

/** Cached per group, since each group is a separate question with a separate answer. */
const cache = new Map<ZdrGroup, { at: number; data: AccountZdrPolicy }>()

/**
 * True for the 404 OpenRouter returns when a data policy left it nowhere to
 * route a request. Zero data retention is one such policy; an account that
 * refuses providers which train on prompts is another, and the two are not
 * distinguishable by message — which is why the probe below pins the endpoint
 * it is asking about rather than reading a refusal at face value.
 */
export function isDataPolicyRefusal(err: unknown): boolean {
  if (!(err instanceof OpenRouterError)) return false
  if (err.statusCode !== 404) return false
  return /data polic/i.test(err.body) || /data polic/i.test(err.message)
}

/**
 * Forgets what is known about a group, so the next read probes again.
 *
 * Called when a real generation is refused on data-policy grounds without this
 * app having asked for anything: the cached answer for that model's group just
 * contradicted reality, and the probe, not the failure, gets to say what
 * replaced it.
 */
export function invalidateAccountZdrPolicy(group?: ZdrGroup): void {
  if (group) cache.delete(group)
  else cache.clear()
}

/**
 * Two budgets, because the two halves of a probe cost different things.
 *
 * Looking a model's endpoints up is a cached catalog read, so the probe can
 * afford to walk a way down the price list looking for one that is actually
 * able to answer — a model every provider serves retention-free cannot tell the
 * two policies apart, and Google's cheap end is full of them. Asking the
 * question costs a token and a round trip, so that stops at three.
 */
const LOOKUP_LIMIT = 12
const ASK_LIMIT = 3

/**
 * How long one probe may take. The catalog is sorted by price, not by
 * liveliness, so the cheapest model of a lab is routinely also its slowest —
 * and a lock hint nobody asked for has no business holding a connection open
 * while a cold provider warms up. A timeout is simply another inconclusive
 * answer, and the next candidate is tried.
 *
 * With retries off (below) this is also the real bound: four candidates, eight
 * seconds each, is the worst a group can cost.
 */
const PROBE_TIMEOUT_MS = 8_000

/** "$1.10" → 1.1, for ordering candidates cheapest first. */
function promptPrice(model: OpenRouterModel): number {
  const n = Number(model.pricing.prompt.replace(/[^0-9.]/g, ""))
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY
}

/**
 * The models worth asking about for one group: that group's own, cheapest
 * first, with everything that cannot answer for the group left out — aliases
 * and the ":free"/":batch" variants, which route differently from the model
 * they are named after, and OpenRouter's own "openrouter/*" routers, which are
 * not a lab at all and would answer for whatever they happened to pick.
 *
 * Cheapest first because asking costs one token whenever the answer is "not
 * enforced" — nothing at all where the group has a free model, and a rounding
 * error on the cheapest Haiku or Nano where it does not. There is no free way
 * to ask about Anthropic or OpenAI: neither lab publishes a free model, and the
 * question cannot be answered by asking about a different lab. That last part
 * is exactly the mistake one account-wide probe makes.
 *
 * Unbounded on purpose — the caller walks it under its own two budgets, and
 * where it has to stop depends on what it finds, not on a number this function
 * could pick.
 */
export function probeCandidates(
  models: OpenRouterModel[],
  group: ZdrGroup
): OpenRouterModel[] {
  return models
    .filter(
      (model) =>
        zdrGroupForModel(model.id) === group &&
        !model.id.startsWith("~") &&
        !model.id.includes(":") &&
        !model.id.startsWith("openrouter/")
    )
    .sort((a, b) => promptPrice(a) - promptPrice(b))
}

/**
 * Asks the account to serve `model` from an endpoint that retains prompts, and
 * reports what it said. Null is "this model could not tell the two policies
 * apart", which is not an answer and not a failure.
 *
 * Pinning is what makes the answer mean anything. An unpinned request to a
 * model with any ZDR endpoint would simply be routed to that one and succeed
 * under either policy; a request pinned to an endpoint that retains can only be
 * refused because something forbade retention. `allowFallbacks: false` is what
 * stops OpenRouter from quietly answering a different question.
 */
async function probeWith(
  core: OpenRouterCore,
  model: OpenRouterModel,
  retaining: ModelEndpoint
): Promise<AccountZdrPolicy | null> {
  try {
    const res = await chatSend(
      core,
      {
        chatRequest: {
          model: model.id,
          // A single token of a single character: the answer is in the routing,
          // and nothing here reads the completion.
          messages: [{ role: "user", content: "." }],
          maxTokens: 1,
          provider: { only: [retaining.tag], allowFallbacks: false },
        },
      },
      {
        timeoutMs: PROBE_TIMEOUT_MS,
        // No retries either. The SDK's default policy backs off through 429s
        // and 5xx, which is right for a generation the writer is waiting on and
        // wrong for a question about a checkbox: a rate-limited group is an
        // inconclusive answer, available now, not a better one in thirty
        // seconds.
        retries: { strategy: "none" },
      }
    )
    if (res.ok) return "not-enforced"
    return isDataPolicyRefusal(res.error) ? "enforced" : null
  } catch (err) {
    return isDataPolicyRefusal(err) ? "enforced" : null
  }
}

/**
 * Whether the account forces zero data retention on one model group, cached an
 * hour per group per server process.
 *
 * There is no API for this. `/key` does not carry it, the guardrails API needs
 * a management key this app does not hold, and `/models/user` is filtered by
 * unrelated account settings too — so the only way to learn it is to ask for
 * something an enforcing account must refuse, and to ask about the right group.
 *
 * The pinned probe answers both ways in one call: served means the account will
 * route this group to a provider that retains, refused on data-policy grounds
 * means it will not. An error that is neither (a rate limit, a provider outage,
 * a model that turns out not to take chat at all) is no answer, and the next
 * candidate is tried. Running out is "unknown", which locks nothing.
 */
export async function accountZdrPolicy(
  group: ZdrGroup
): Promise<AccountZdrPolicy> {
  const hit = cache.get(group)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data

  const key = resolveOpenRouterKey()
  if (!key) return "unknown"

  const core = new OpenRouterCore({ apiKey: key, appTitle: "draft-zero" })
  let policy: AccountZdrPolicy = "unknown"
  let lookups = 0
  let asks = 0
  for (const model of probeCandidates(await listModels(), group)) {
    if (lookups >= LOOKUP_LIMIT || asks >= ASK_LIMIT) break
    lookups += 1
    const retaining = (await listModelEndpoints(model.id)).find((e) => !e.zdr)
    // Every provider of this model keeps nothing already, so serving it proves
    // nothing about the policy. Cheap to discover and worth walking past —
    // whole price bands of a lab's catalog can look like this.
    if (!retaining) continue
    asks += 1
    const answer = await probeWith(core, model, retaining)
    if (answer) {
      policy = answer
      break
    }
  }

  // "unknown" is cached too, and deliberately: a rate-limited group stays rate
  // limited, and retrying on every render would turn a few wasted requests into
  // a stream of them.
  cache.set(group, { at: Date.now(), data: policy })
  return policy
}

/** The group a model belongs to, answered for that model. The common case. */
export async function accountZdrPolicyForModel(
  modelId: string
): Promise<AccountZdrPolicy> {
  return accountZdrPolicy(zdrGroupForModel(modelId))
}

/**
 * Every group's verdict, for the one surface with no model in front of it: the
 * app-wide switch in Settings, which is about all five at once.
 *
 * Five groups at once rather than one after another. Each is already bounded by
 * PROBE_TIMEOUT_MS and each is at most a handful of one-token requests, so the
 * wall clock is one group's worth rather than five — and this runs behind a
 * rendered page, once an hour, for a line of muted text.
 */
export async function accountZdrPolicies(): Promise<AccountZdrPolicies> {
  const entries = await Promise.all(
    ZDR_GROUPS.map(
      async (group) =>
        [group, await accountZdrPolicy(group)] as [ZdrGroup, AccountZdrPolicy]
    )
  )
  return Object.fromEntries(entries) as AccountZdrPolicies
}
