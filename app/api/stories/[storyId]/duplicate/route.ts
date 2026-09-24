// POST /api/stories/:storyId/duplicate — body { copyId? }; send {} to let the
// server mint the copy's id. A client-minted copyId makes a retry idempotent.
import { contextOf, readJson, refuse, respond } from "@/lib/api/respond"
import { duplicateStory } from "@/lib/services/stories"
import {
  storyCreatedOutput,
  type DuplicateStoryInput,
} from "@/lib/services/stories.schema"

export const runtime = "nodejs"

type Params = { params: Promise<{ storyId: string }> }

export async function POST(
  request: Request,
  { params }: Params
): Promise<Response> {
  const { storyId } = await params
  const body = await readJson(request)
  if (!body.ok) return refuse(body)
  const { copyId } = (body.data ?? {}) as Partial<DuplicateStoryInput>
  const result = await duplicateStory(
    { id: storyId, copyId },
    contextOf(request)
  )
  return respond(storyCreatedOutput, result)
}
