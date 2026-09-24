// POST   /api/stories/:storyId/generation — start a run. The body is the rest of
//        the service's input (lib/services/generation.schema.ts). The answer is
//        the run's identity; prose streams from
//        GET /api/generation/subscribe?storyId=…&runId=….
// DELETE /api/stories/:storyId/generation — stop it. Optional body:
//        { runId?, startTurnId? }, as the stop service takes them.
import { contextOf, readJson, refuse, respond } from "@/lib/api/respond"
import { startGeneration, stopGeneration } from "@/lib/services/generation"
import {
  startGenerationOutput,
  stopGenerationOutput,
  type StartGenerationInput,
  type StopGenerationInput,
} from "@/lib/services/generation.schema"

// Node, explicitly: the run registry lives on globalThis in this one process,
// and an edge isolate would never see the run it just started.
export const runtime = "nodejs"

type Params = { params: Promise<{ storyId: string }> }

export async function POST(
  request: Request,
  { params }: Params
): Promise<Response> {
  const { storyId } = await params
  const body = await readJson(request)
  if (!body.ok) return refuse(body)
  const result = await startGeneration(
    { ...(body.data as Omit<StartGenerationInput, "storyId">), storyId },
    contextOf(request)
  )
  return respond(startGenerationOutput, result)
}

export async function DELETE(
  request: Request,
  { params }: Params
): Promise<Response> {
  const { storyId } = await params
  const body = await readJson(request, { allowEmpty: true })
  if (!body.ok) return refuse(body)
  const result = await stopGeneration(
    { ...(body.data as Omit<StopGenerationInput, "storyId">), storyId },
    contextOf(request)
  )
  return respond(stopGenerationOutput, result)
}
