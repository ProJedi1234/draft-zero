// POST /api/stories/:storyId/illustrations/:imageGroupId/step — moves to the
// neighbouring take. Body: { offset: 1 | -1 }.
import { contextOf, readJson, refuse, respond } from "@/lib/api/respond"
import { selectImageByOffset } from "@/lib/services/images"
import {
  illustrationWriteOutput,
  type SelectImageByOffsetInput,
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
  const { offset } = (body.data ?? {}) as Partial<SelectImageByOffsetInput>
  const result = await selectImageByOffset(
    { storyId, imageGroupId, offset: offset as number },
    contextOf(request)
  )
  return respond(illustrationWriteOutput, result)
}
