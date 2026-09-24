// PATCH /api/stories/:storyId/image-model — body { imageModelId: string | null };
// null follows the app's default image model.
import { contextOf, readJson, refuse, respond } from "@/lib/api/respond"
import { setStoryImageModel } from "@/lib/services/stories"
import {
  storyEmptyOutput,
  type SetStoryImageModelInput,
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
  const { imageModelId } = (body.data ?? {}) as SetStoryImageModelInput
  const result = await setStoryImageModel(
    { id: storyId, imageModelId },
    contextOf(request)
  )
  return respond(storyEmptyOutput, result)
}
