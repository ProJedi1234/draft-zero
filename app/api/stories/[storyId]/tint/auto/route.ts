// PATCH /api/stories/:storyId/tint/auto — body { auto: boolean }. Moves only
// the flag; the story keeps the colour it is wearing.
import { contextOf, readJson, refuse, respond } from "@/lib/api/respond"
import { setStoryTintAuto } from "@/lib/services/stories"
import {
  storyWriteOutput,
  type SetStoryTintAutoInput,
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
  const { auto } = (body.data ?? {}) as SetStoryTintAutoInput
  const result = await setStoryTintAuto(
    { id: storyId, auto },
    contextOf(request)
  )
  return respond(storyWriteOutput, result)
}
