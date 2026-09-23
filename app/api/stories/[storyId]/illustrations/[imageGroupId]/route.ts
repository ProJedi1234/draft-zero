// DELETE /api/stories/:storyId/illustrations/:imageGroupId — soft-deletes the
// whole slot, every take. Undone by POST …/restore.
import { contextOf, respond } from "@/lib/api/respond"
import { deleteIllustration } from "@/lib/services/images"
import { illustrationWriteOutput } from "@/lib/services/images.schema"

export const runtime = "nodejs"

type Params = { params: Promise<{ storyId: string; imageGroupId: string }> }

export async function DELETE(
  request: Request,
  { params }: Params
): Promise<Response> {
  const { storyId, imageGroupId } = await params
  const result = await deleteIllustration(
    { storyId, imageGroupId },
    contextOf(request)
  )
  return respond(illustrationWriteOutput, result)
}
