import { contextOf, readJson, refuse, respond } from "@/lib/api/respond"
import { applyWorldPatch } from "@/lib/services/world"
import {
  applyWorldPatchOutput,
  type ApplyWorldPatchInput,
} from "@/lib/services/world.schema"

export const runtime = "nodejs"

type Params = { params: Promise<{ storyId: string }> }

export async function POST(request: Request, { params }: Params) {
  const { storyId } = await params
  const body = await readJson(request)
  if (!body.ok) return refuse(body)
  return respond(
    applyWorldPatchOutput,
    await applyWorldPatch(
      { storyId, ops: body.data.ops as ApplyWorldPatchInput["ops"] },
      contextOf(request)
    )
  )
}
