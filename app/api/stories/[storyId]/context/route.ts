// GET /api/stories/:storyId/context — what the next passage would be sent,
// composed from the whole manuscript as it stands. The inspector's context
// meter reads it.
import { contextOf, respond } from "@/lib/api/respond"
import { loadNextContext } from "@/lib/services/entries"
import { nextContextOutput } from "@/lib/services/entries.schema"

export const runtime = "nodejs"

type Params = { params: Promise<{ storyId: string }> }

export async function GET(
  request: Request,
  { params }: Params
): Promise<Response> {
  const { storyId } = await params
  const result = await loadNextContext({ storyId }, contextOf(request))
  return respond(nextContextOutput, result)
}
