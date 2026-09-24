// POST /api/stories/:storyId/illustration/stop — aborts the story's live draw.
// Body: { runId?: string | null }. Omitting runId aborts whatever is drawing.
import { contextOf, readJson, refuse, respond } from "@/lib/api/respond"
import { stopIllustration } from "@/lib/services/images"
import {
  illustrationWriteOutput,
  type StopIllustrationInput,
} from "@/lib/services/images.schema"

export const runtime = "nodejs"

type Params = { params: Promise<{ storyId: string }> }

export async function POST(
  request: Request,
  { params }: Params
): Promise<Response> {
  const { storyId } = await params
  const body = await readJson(request)
  if (!body.ok) return refuse(body)
  const { runId } = (body.data ?? {}) as Partial<StopIllustrationInput>
  const result = await stopIllustration({ storyId, runId }, contextOf(request))
  return respond(illustrationWriteOutput, result)
}
