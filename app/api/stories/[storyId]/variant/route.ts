// POST /api/stories/:storyId/variant — switch the newest passage's take.
// Body: { entryId, offset }, offset -1 for the previous take and +1 for the
// next. Answers { summary }, or null at either end.
import { contextOf, readJson, refuse, respond } from "@/lib/api/respond"
import { selectVariantByOffset } from "@/lib/services/history"
import {
  historyMoveOutput,
  type SelectVariantInput,
} from "@/lib/services/history.schema"

export const runtime = "nodejs"

type Params = { params: Promise<{ storyId: string }> }

export async function POST(
  request: Request,
  { params }: Params
): Promise<Response> {
  const { storyId } = await params
  const body = await readJson(request)
  if (!body.ok) return refuse(body)
  const result = await selectVariantByOffset(
    { ...(body.data as Omit<SelectVariantInput, "storyId">), storyId },
    contextOf(request)
  )
  return respond(historyMoveOutput, result)
}
