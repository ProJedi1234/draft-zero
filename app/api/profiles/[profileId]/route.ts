// PATCH  /api/profiles/:profileId — the body is the patch, { name?, settings? };
//                                   only given fields move.
// DELETE /api/profiles/:profileId — followers flip to Custom; the default is a 409.
import { contextOf, readJson, refuse, respond } from "@/lib/api/respond"
import { deleteProfile, updateProfile } from "@/lib/services/profiles"
import {
  profileWriteOutput,
  type UpdateProfileInput,
} from "@/lib/services/profiles.schema"

export const runtime = "nodejs"

type Params = { params: Promise<{ profileId: string }> }

export async function PATCH(
  request: Request,
  { params }: Params
): Promise<Response> {
  const { profileId } = await params
  const body = await readJson(request)
  if (!body.ok) return refuse(body)
  const result = await updateProfile(
    { id: profileId, patch: body.data as UpdateProfileInput["patch"] },
    contextOf(request)
  )
  return respond(profileWriteOutput, result)
}

export async function DELETE(
  request: Request,
  { params }: Params
): Promise<Response> {
  const { profileId } = await params
  const result = await deleteProfile({ id: profileId }, contextOf(request))
  return respond(profileWriteOutput, result)
}
