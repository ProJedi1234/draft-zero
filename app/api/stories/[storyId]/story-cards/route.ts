// POST /api/stories/:storyId/story-cards — merge an AI Dungeon card export into
// an existing story's lorebook. The body is { json }, the raw file text.
import { contextOf, readJson, refuse, respond } from "@/lib/api/respond"
import { importStoryCardsIntoStory } from "@/lib/services/import"
import {
  storyCardMergeOutput,
  type ImportStoryCardsIntoStoryInput,
} from "@/lib/services/import.schema"

export const runtime = "nodejs"

type Params = { params: Promise<{ storyId: string }> }

export async function POST(
  request: Request,
  { params }: Params
): Promise<Response> {
  const { storyId } = await params
  const body = await readJson(request)
  if (!body.ok) return refuse(body)
  const data = body.data as Partial<ImportStoryCardsIntoStoryInput> | null
  const result = await importStoryCardsIntoStory(
    { json: data?.json as string, storyId },
    contextOf(request)
  )
  return respond(storyCardMergeOutput, result)
}
