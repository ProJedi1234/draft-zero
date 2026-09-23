// GET /api/zdr/:author/:slug — the verdict for the group one model belongs to.
// A catch-all because model ids carry a slash.
import { contextOf, respond } from "@/lib/api/respond"
import { getAccountZdrForModel } from "@/lib/services/zdr"
import { accountZdrPolicyRecord } from "@/lib/services/zdr.schema"

export const runtime = "nodejs"

type Params = { params: Promise<{ modelId: string[] }> }

export async function GET(
  request: Request,
  { params }: Params
): Promise<Response> {
  const { modelId } = await params
  const result = await getAccountZdrForModel(
    { modelId: modelId.join("/") },
    contextOf(request)
  )
  return respond(accountZdrPolicyRecord, result)
}
