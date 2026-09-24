// POST /api/profiles/:profileId/default — make this the profile new stories
// start from. No body.
import { contextOf, respond } from "@/lib/api/respond"
import { setDefaultProfile } from "@/lib/services/profiles"
import { profileWriteOutput } from "@/lib/services/profiles.schema"

export const runtime = "nodejs"

type Params = { params: Promise<{ profileId: string }> }

export async function POST(
  request: Request,
  { params }: Params
): Promise<Response> {
  const { profileId } = await params
  const result = await setDefaultProfile({ id: profileId }, contextOf(request))
  return respond(profileWriteOutput, result)
}
