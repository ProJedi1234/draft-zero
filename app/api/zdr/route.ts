// GET /api/zdr — the account's zero-data-retention verdict for every group.
import { contextOf, respond } from "@/lib/api/respond"
import { getAccountZdrPolicies } from "@/lib/services/zdr"
import { getAccountZdrPoliciesOutput } from "@/lib/services/zdr.schema"

export const runtime = "nodejs"

export async function GET(request: Request): Promise<Response> {
  const result = await getAccountZdrPolicies({}, contextOf(request))
  return respond(getAccountZdrPoliciesOutput, result)
}
