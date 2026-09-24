// POST /api/stories/:storyId/illustrations/:imageGroupId/restore — undoes a
// DELETE of the slot.
import { contextOf, respond } from "@/lib/api/respond"
import { restoreIllustration } from "@/lib/services/images"
import { illustrationWriteOutput } from "@/lib/services/images.schema"

export const runtime = "nodejs"

type Params = { params: Promise<{ storyId: string; imageGroupId: string }> }

export async function POST(
  request: Request,
  { params }: Params
): Promise<Response> {
  const { storyId, imageGroupId } = await params
  const result = await restoreIllustration(
    { storyId, imageGroupId },
    contextOf(request)
  )
  return respond(illustrationWriteOutput, result)
}
