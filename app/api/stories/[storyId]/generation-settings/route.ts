// PATCH /api/stories/:storyId/generation-settings — the body is a partial
// GenerationSettings; only given fields move.
import { contextOf, readJson, refuse, respond } from "@/lib/api/respond"
import { updateGenerationSettings } from "@/lib/services/stories"
import {
  storyEmptyOutput,
  type UpdateGenerationSettingsInput,
} from "@/lib/services/stories.schema"

export const runtime = "nodejs"

type Params = { params: Promise<{ storyId: string }> }

export async function PATCH(
  request: Request,
  { params }: Params
): Promise<Response> {
  const { storyId } = await params
  const body = await readJson(request)
  if (!body.ok) return refuse(body)
  const result = await updateGenerationSettings(
    {
      id: storyId,
      patch: body.data as UpdateGenerationSettingsInput["patch"],
    },
    contextOf(request)
  )
  return respond(storyEmptyOutput, result)
}
