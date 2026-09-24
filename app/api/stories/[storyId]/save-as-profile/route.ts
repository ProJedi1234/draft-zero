// POST /api/stories/:storyId/save-as-profile — the body is { name }. Creates a
// profile from the story's effective settings and points the story at it.
import { contextOf, readJson, refuse, respond } from "@/lib/api/respond"
import { saveStoryAsProfile } from "@/lib/services/profiles"
import {
  profileIdOutput,
  type SaveStoryAsProfileInput,
} from "@/lib/services/profiles.schema"

export const runtime = "nodejs"

type Params = { params: Promise<{ storyId: string }> }

export async function POST(
  request: Request,
  { params }: Params
): Promise<Response> {
  const { storyId } = await params
  const body = await readJson(request)
  if (!body.ok) return refuse(body)
  const result = await saveStoryAsProfile(
    { ...(body.data as Omit<SaveStoryAsProfileInput, "storyId">), storyId },
    contextOf(request)
  )
  return respond(profileIdOutput, result)
}
