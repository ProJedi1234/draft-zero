// GET  /api/stories?offset=0&query=… — one window of the library, newest first.
// POST /api/stories — create a story. Body: { title?, id? }, both optional.
import { contextOf, readJson, refuse, respond } from "@/lib/api/respond"
import { createStory, loadStoryPage } from "@/lib/services/stories"
import {
  storyCreatedOutput,
  storyPageOutput,
  type CreateStoryInput,
} from "@/lib/services/stories.schema"

export const runtime = "nodejs"

export async function GET(request: Request): Promise<Response> {
  const search = new URL(request.url).searchParams
  const offset = search.get("offset")
  const result = await loadStoryPage({
    // A present but non-numeric offset becomes NaN, which the schema refuses.
    offset: offset === null ? 0 : Number(offset),
    query: search.get("query") ?? undefined,
  })
  return respond(storyPageOutput, result)
}

export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request)
  if (!body.ok) return refuse(body)
  const result = await createStory(
    body.data as CreateStoryInput,
    contextOf(request)
  )
  return respond(storyCreatedOutput, result)
}
