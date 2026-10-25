import { contextOf, respond } from "@/lib/api/respond"
import { getWorldState } from "@/lib/services/world"
import { getWorldOutput } from "@/lib/services/world.schema"

export const runtime = "nodejs"

type Params = { params: Promise<{ storyId: string }> }

export async function GET(request: Request, { params }: Params) {
  const { storyId } = await params
  return respond(
    getWorldOutput,
    await getWorldState({ storyId }, contextOf(request))
  )
}
