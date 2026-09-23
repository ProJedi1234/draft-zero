// POST /api/stories/:storyId/redo — no body. Answers { summary } for what
// moved, or null when there was nothing to redo.
import { contextOf, respond } from "@/lib/api/respond"
import { redoStoryOp } from "@/lib/services/history"
import { historyMoveOutput } from "@/lib/services/history.schema"

export const runtime = "nodejs"

type Params = { params: Promise<{ storyId: string }> }

export async function POST(
  request: Request,
  { params }: Params
): Promise<Response> {
  const { storyId } = await params
  const result = await redoStoryOp({ storyId }, contextOf(request))
  return respond(historyMoveOutput, result)
}
