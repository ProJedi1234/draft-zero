// lib/services/zdr.schema.ts — The account retention reads' request and
// response contract. Isomorphic: no server imports, so a contract package can
// lift it.
import { z } from "zod"

import { ZDR_GROUPS } from "@/lib/types"

export const getAccountZdrForModelInput = z.object({
  modelId: z.string({ error: "Invalid model id." }),
})

export const getAccountZdrPoliciesInput = z.object({})

export const accountZdrPolicyRecord = z.enum([
  "enforced",
  "not-enforced",
  "unknown",
])

export const getAccountZdrPoliciesOutput = z.object(
  Object.fromEntries(
    ZDR_GROUPS.map((group) => [group, accountZdrPolicyRecord])
  ) as Record<(typeof ZDR_GROUPS)[number], typeof accountZdrPolicyRecord>
)

export type GetAccountZdrForModelInput = z.input<
  typeof getAccountZdrForModelInput
>
export type GetAccountZdrPoliciesInput = z.input<
  typeof getAccountZdrPoliciesInput
>
