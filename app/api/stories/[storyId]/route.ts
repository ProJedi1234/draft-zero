// PATCH  /api/stories/:storyId — the body is the metadata patch; only given
//        fields move (title, description, genre, memory, authorsNote,
//        systemPrompt, summarize).
// DELETE /api/stories/:storyId — idempotent; a story already gone answers 200.
import { contextOf, readJson, refuse, respond } from "@/lib/api/respond"
import { deleteStory, updateStoryMeta } from "@/lib/services/stories"
import {
  storyEmptyOutput,
  storyWriteOutput,
  type UpdateStoryMetaInput,
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
  const result = await updateStoryMeta(
    { id: storyId, patch: body.data as UpdateStoryMetaInput["patch"] },
    contextOf(request)
  )
  return respond(storyWriteOutput, result)
}

export async function DELETE(
  request: Request,
  { params }: Params
): Promise<Response> {
  const { storyId } = await params
  const result = await deleteStory({ id: storyId }, contextOf(request))
  return respond(storyEmptyOutput, result)
}
