// POST /api/image — launch an illustration run and return its id.
//
// Thin on purpose, like startGeneration: the draw itself is a detached task in
// lib/images/live.ts that outlives this request, because the request is the
// first thing that can die — a closed tab or a sleeping phone must not take a
// thirty-second render with it. The client subscribes to
// /api/image/subscribe with the runId this returns; every other device on the
// story gets the same runId over the sync channel's image-run-started.
import { getStory } from "@/lib/db/queries"
import { launchImageRun } from "@/lib/images/live"
import { resolveImageModelId } from "@/lib/images/models"
import { IMAGE_ASPECT_RATIOS, type ImageAspectRatio } from "@/lib/types"

export const runtime = "nodejs"

interface Body {
  storyId?: unknown
  prompt?: unknown
  sourcePrompt?: unknown
  promptLoreIds?: unknown
  aspectRatio?: unknown
  imageGroupId?: unknown
  modelId?: unknown
}

/** A brief is a sentence or two; the ceiling only exists to bound the column. */
const MAX_SOURCE_PROMPT_CHARS = 4_000
/** Far past any lorebook a brief could plausibly summon. */
const MAX_PROMPT_LORE_IDS = 200

export async function POST(req: Request): Promise<Response> {
  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return Response.json({ error: "Malformed request." }, { status: 400 })
  }

  const storyId = typeof body.storyId === "string" ? body.storyId : ""
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : ""
  // Provenance, not instruction: neither of these reaches the provider — they
  // are recorded beside the picture so a finished image can say what the writer
  // actually asked for and which lore answered.
  const sourcePrompt =
    typeof body.sourcePrompt === "string" && body.sourcePrompt.trim() !== ""
      ? body.sourcePrompt.trim().slice(0, MAX_SOURCE_PROMPT_CHARS)
      : null
  const promptLoreIds = Array.isArray(body.promptLoreIds)
    ? body.promptLoreIds
        .filter((id): id is string => typeof id === "string" && id !== "")
        .slice(0, MAX_PROMPT_LORE_IDS)
    : []
  const aspectRatio = body.aspectRatio as ImageAspectRatio
  const imageGroupId =
    typeof body.imageGroupId === "string" ? body.imageGroupId : undefined
  // A per-request override — the retry menu's "redraw this take with…". It
  // does not touch the story's stored choice, which is the promise the menu
  // makes; and it is honoured verbatim like any explicit pick, so an
  // ineligible model under ZDR is refused with the message naming the fix.
  const modelOverride =
    typeof body.modelId === "string" && body.modelId !== ""
      ? body.modelId
      : null

  if (storyId === "" || prompt === "") {
    return Response.json(
      { error: "A story and a prompt are required." },
      { status: 400 }
    )
  }
  if (!IMAGE_ASPECT_RATIOS.includes(aspectRatio)) {
    return Response.json(
      { error: "Unsupported aspect ratio." },
      { status: 400 }
    )
  }

  const story = await getStory(storyId)
  if (!story)
    return Response.json({ error: "Story not found." }, { status: 404 })

  // settings.zdr is the story's effective policy — resolve has already folded
  // the app-wide floor in. It bends the default model toward one a ZDR request
  // can actually route to, and travels with the run so the provider fails
  // closed rather than trusting account settings to catch it.
  const zdr = story.settings.zdr
  const modelId =
    modelOverride ?? (await resolveImageModelId(story.imageModelId, zdr))

  // Seeded from the clock: takes of one slot differ only by seed, so a seed
  // that repeats is a retry that returns the picture it meant to replace.
  const seed = Date.now() % 0x7fffffff

  const launched = launchImageRun({
    storyId: story.id,
    storyTitle: story.title,
    prompt,
    sourcePrompt,
    promptLoreIds,
    aspectRatio,
    imageGroupId,
    modelId,
    zdr,
    seed,
  })
  if (!launched) {
    return Response.json(
      { error: "An illustration is already being drawn for this story." },
      { status: 409 }
    )
  }

  return Response.json({ runId: launched.runId })
}
