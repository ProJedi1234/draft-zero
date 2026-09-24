// lib/services/zdr.ts — What the OpenRouter account enforces, callable from a
// server action, a route handler or an MCP tool alike.
import "server-only"

import {
  accountZdrPolicies,
  accountZdrPolicyForModel,
} from "@/lib/generation/zdr-account"
import type { Service } from "@/lib/services/context"
import { ok, parseInput } from "@/lib/services/result"
import {
  getAccountZdrForModelInput,
  getAccountZdrPoliciesInput,
  type GetAccountZdrForModelInput,
  type GetAccountZdrPoliciesInput,
} from "@/lib/services/zdr.schema"
import type { AccountZdrPolicies, AccountZdrPolicy } from "@/lib/types"

/**
 * Whether the OpenRouter account already forces zero data retention on the
 * group `modelId` belongs to — the question every control with a model in front
 * of it is actually asking.
 *
 * Read after mount rather than passed as a prop on the page: answering it costs
 * a round trip to OpenRouter the first time, and no page should wait on a lock
 * state to render the writing surface. Cached per group per server process, so
 * every later ask is free.
 */
export const getAccountZdrForModel: Service<
  GetAccountZdrForModelInput,
  AccountZdrPolicy
> = async (raw) => {
  const parsed = parseInput(getAccountZdrForModelInput, raw)
  if (!parsed.ok) return parsed
  const { modelId } = parsed.data
  if (modelId.trim() === "") return ok("unknown")
  return ok(await accountZdrPolicyForModel(modelId))
}

/**
 * All five groups, for the app-wide switch in Settings — the one control that
 * is about every model at once and so cannot ask about just one.
 */
export const getAccountZdrPolicies: Service<
  GetAccountZdrPoliciesInput,
  AccountZdrPolicies
> = async (raw) => {
  const parsed = parseInput(getAccountZdrPoliciesInput, raw)
  if (!parsed.ok) return parsed
  return ok(await accountZdrPolicies())
}
