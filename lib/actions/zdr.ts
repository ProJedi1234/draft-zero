"use server"

import {
  accountZdrPolicies,
  accountZdrPolicyForModel,
} from "@/lib/generation/zdr-account"
import type { AccountZdrPolicies, AccountZdrPolicy } from "@/lib/types"

/**
 * Whether the OpenRouter account already forces zero data retention on the
 * group `modelId` belongs to — the question every control with a model in front
 * of it is actually asking.
 *
 * A server action rather than a prop on the page, for the reason
 * getModelEndpoints is one: answering it costs a round trip to OpenRouter the
 * first time, and no page should wait on a lock state to render the writing
 * surface. Cached per group per server process, so every later ask is free.
 */
export async function getAccountZdrForModel(
  modelId: string
): Promise<AccountZdrPolicy> {
  if (modelId.trim() === "") return "unknown"
  return accountZdrPolicyForModel(modelId)
}

/**
 * All five groups, for the app-wide switch in Settings — the one control that
 * is about every model at once and so cannot ask about just one.
 */
export async function getAccountZdrPolicies(): Promise<AccountZdrPolicies> {
  return accountZdrPolicies()
}
