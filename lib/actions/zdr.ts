"use server"

import { accountZdrPolicy } from "@/lib/generation/zdr"
import type { AccountZdrPolicy } from "@/lib/types"

/**
 * Whether the OpenRouter account already forces zero data retention, for the
 * controls that lock themselves when it does.
 *
 * A server action rather than a prop on the page, for the reason
 * getModelEndpoints is one: answering it costs a round trip to OpenRouter the
 * first time, and no page should wait on a lock state to render the writing
 * surface. Cached an hour per server process, so every later ask is free.
 */
export async function getAccountZdrPolicy(): Promise<AccountZdrPolicy> {
  return accountZdrPolicy()
}
