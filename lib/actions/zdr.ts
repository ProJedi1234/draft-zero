"use server"

import { NO_ORIGIN } from "@/lib/services/context"
import * as zdr from "@/lib/services/zdr"
import type { AccountZdrPolicies, AccountZdrPolicy } from "@/lib/types"

export async function getAccountZdrForModel(
  modelId: string
): Promise<AccountZdrPolicy> {
  const result = await zdr.getAccountZdrForModel({ modelId }, NO_ORIGIN)
  // Only a non-string id fails, and "unknown" is what locks nothing.
  return result.ok ? result.data : "unknown"
}

export async function getAccountZdrPolicies(): Promise<AccountZdrPolicies> {
  const result = await zdr.getAccountZdrPolicies({}, NO_ORIGIN)
  if (!result.ok) throw new Error(result.error)
  return result.data
}
