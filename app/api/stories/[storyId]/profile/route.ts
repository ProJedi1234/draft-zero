// POST /api/stories/:storyId/profile — the body is { profileId }, or
// { profileId: null } to switch the story to Custom.
import { contextOf, readJson, refuse, respond } from "@/lib/api/respond"
import { setStoryProfile } from "@/lib/services/profiles"
import {
  profileWriteOutput,
  type SetStoryProfileInput,
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
  const result = await setStoryProfile(
    { ...(body.data as Omit<SetStoryProfileInput, "storyId">), storyId },
    contextOf(request)
  )
  return respond(profileWriteOutput, result)
}
