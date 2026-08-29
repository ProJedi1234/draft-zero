// GET /api/story/[storyId]/workspace — the workspace's mount props, over fetch.
//
// The story route renders a shell and this fills it, so switching stories costs
// a fetch the client can serve from its own cache instead of a navigation that
// blocks on eight queries. Same builder the route uses, so the two cannot drift.
import { isValidEntityId } from "@/lib/store/records"
import { buildStoryWorkspacePayload } from "@/lib/story/workspace-payload"

export const runtime = "nodejs"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ storyId: string }> }
): Promise<Response> {
  const { storyId } = await params

  if (!isValidEntityId(storyId)) {
    return json({ error: "Invalid story id." }, 400)
  }

  const payload = await buildStoryWorkspacePayload(storyId)

  // A real 404: unlike the store's scoped snapshot, an absent story here is not
  // a delete to adopt — it is a story the loader cannot paint, and the shell
  // needs to tell them apart from a pending create it should keep waiting on.
  if (payload === null) {
    return json({ error: "Story not found." }, 404)
  }

  return json(payload, 200)
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  })
}
