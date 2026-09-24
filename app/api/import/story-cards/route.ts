// POST /api/import/story-cards — import an AI Dungeon card export as a new
// story. The body is { json }, the raw file text.
import { contextOf, readJson, refuse, respond } from "@/lib/api/respond"
import { importStoryCards } from "@/lib/services/import"
import {
  storyCardImportOutput,
  type ImportStoryCardsInput,
} from "@/lib/services/import.schema"

export const runtime = "nodejs"

export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request)
  if (!body.ok) return refuse(body)
  const result = await importStoryCards(
    body.data as ImportStoryCardsInput,
    contextOf(request)
  )
  return respond(storyCardImportOutput, result)
}
