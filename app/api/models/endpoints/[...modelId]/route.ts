// GET /api/models/endpoints/:author/:slug — the endpoints serving one model.
// A catch-all because model ids carry a slash, and a catch-all must end the path.
import { contextOf, respond } from "@/lib/api/respond"
import { getModelEndpoints } from "@/lib/services/models"
import { getModelEndpointsOutput } from "@/lib/services/models.schema"

export const runtime = "nodejs"

type Params = { params: Promise<{ modelId: string[] }> }

export async function GET(
  request: Request,
  { params }: Params
): Promise<Response> {
  const { modelId } = await params
  const result = await getModelEndpoints(
    { modelId: modelId.join("/") },
    contextOf(request)
  )
  return respond(getModelEndpointsOutput, result)
}
