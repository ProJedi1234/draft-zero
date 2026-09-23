// PATCH /api/stories/:storyId/tint — body { hue: number | null, strength?, auto? }.
// Out-of-range numbers are clamped, not refused; see updateStoryTint.
import { contextOf, readJson, refuse, respond } from "@/lib/api/respond"
import { updateStoryTint } from "@/lib/services/stories"
import {
  storyWriteOutput,
  type UpdateStoryTintInput,
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
  const result = await updateStoryTint(
    { id: storyId, patch: body.data as UpdateStoryTintInput["patch"] },
    contextOf(request)
  )
  return respond(storyWriteOutput, result)
}
