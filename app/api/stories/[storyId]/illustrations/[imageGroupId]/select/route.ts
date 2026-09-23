// POST /api/stories/:storyId/illustrations/:imageGroupId/select — makes the
// named take the slot's active one. Body: { imageId: string }.
import { contextOf, readJson, refuse, respond } from "@/lib/api/respond"
import { selectImageById } from "@/lib/services/images"
import {
  illustrationWriteOutput,
  type SelectImageByIdInput,
} from "@/lib/services/images.schema"

export const runtime = "nodejs"

type Params = { params: Promise<{ storyId: string; imageGroupId: string }> }

export async function POST(
  request: Request,
  { params }: Params
): Promise<Response> {
  const { storyId, imageGroupId } = await params
  const body = await readJson(request)
  if (!body.ok) return refuse(body)
  const { imageId } = (body.data ?? {}) as Partial<SelectImageByIdInput>
  const result = await selectImageById(
    { storyId, imageGroupId, imageId: imageId as string },
    contextOf(request)
  )
  return respond(illustrationWriteOutput, result)
}
