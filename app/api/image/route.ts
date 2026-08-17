// POST /api/image — generate an illustration and persist it.
//
// A route rather than a server action for one reason: Stop. A server action
// resolves once and cannot be cancelled, so a "stop" against one could only
// stop the client listening while the request ran on and billed. Here the
// client's abort travels down `req.signal`, aborts the upstream fetch, and the
// generation genuinely ends — which is what makes the Stop tooltip's promise
// about all-or-nothing billing true rather than decorative.
import { createIllustration } from "@/lib/actions/images"
import { getStory } from "@/lib/db/queries"
import { recordCallStarted, settleCall } from "@/lib/generation/calls"
import { resolveOpenRouterKey } from "@/lib/generation/key"
import { MockImageProvider } from "@/lib/images/mock-provider"
import { resolveImageModelId } from "@/lib/images/models"
import { OpenRouterImageProvider } from "@/lib/images/openrouter"
import type { ImageGenerationProvider } from "@/lib/images/types"
import { IMAGE_ASPECT_RATIOS, type ImageAspectRatio } from "@/lib/types"

export const runtime = "nodejs"

/** Generation can take a while; images are slower than a first text token. */
export const maxDuration = 300

interface Body {
  storyId?: unknown
  prompt?: unknown
  aspectRatio?: unknown
  imageGroupId?: unknown
}

export async function POST(req: Request): Promise<Response> {
  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return Response.json({ error: "Malformed request." }, { status: 400 })
  }

  const storyId = typeof body.storyId === "string" ? body.storyId : ""
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : ""
  const aspectRatio = body.aspectRatio as ImageAspectRatio
  const imageGroupId =
    typeof body.imageGroupId === "string" ? body.imageGroupId : undefined

  if (storyId === "" || prompt === "") {
    return Response.json(
      { error: "A story and a prompt are required." },
      { status: 400 }
    )
  }
  if (!IMAGE_ASPECT_RATIOS.includes(aspectRatio)) {
    return Response.json({ error: "Unsupported aspect ratio." }, { status: 400 })
  }

  const story = await getStory(storyId)
  if (!story) return Response.json({ error: "Story not found." }, { status: 404 })

  const modelId = await resolveImageModelId(story.imageModelId)
  const key = resolveOpenRouterKey()

  // Seeded from the clock: takes of one slot differ only by seed, so a seed
  // that repeats is a retry that returns the picture it meant to replace.
  const seed = Date.now() % 0x7fffffff

  const provider: ImageGenerationProvider = key
    ? new OpenRouterImageProvider(key)
    : new MockImageProvider()

  // The offline mock bills nothing, so it opens no ledger row — the same rule
  // the text mock follows. A row with a null cost would be indistinguishable
  // from a real call OpenRouter declined to price.
  const callId = key ? crypto.randomUUID() : null
  if (callId) {
    await recordCallStarted({
      id: callId,
      storyId: story.id,
      origStoryId: story.id,
      storyTitle: story.title,
      requestKind: "illustrate",
      modelId,
      // Images do not think. Null rather than "off", which would claim a
      // reasoning setting was consulted and declined.
      thinking: null,
      providerName: null,
    })
  }

  const controller = new AbortController()
  req.signal.addEventListener("abort", () => controller.abort(), { once: true })

  try {
    let final: {
      b64: string
      mediaType: string
      costUsd: number | null
      promptTokens: number | null
      completionTokens: number | null
    } | null = null

    for await (const event of provider.generate({
      prompt,
      modelId,
      aspectRatio,
      seed,
      signal: controller.signal,
    })) {
      // Partials are dropped: this response is a single JSON object, not a
      // stream. Only the mock emits them today, and rendering a preview the
      // real provider cannot produce would make the offline path feel better
      // than the live one — exactly backwards.
      if (event.type === "completed") {
        final = {
          b64: event.b64,
          mediaType: event.mediaType,
          costUsd: event.usage.costUsd,
          promptTokens: event.usage.promptTokens,
          completionTokens: event.usage.completionTokens,
        }
      }
    }

    if (controller.signal.aborted || final === null) {
      // Stopped, or a provider that ended without an image. Under OpenRouter's
      // all-or-nothing image billing nothing was charged either way, so the row
      // settles with no cost rather than an invented one.
      if (callId) {
        await settleCall(callId, {
          status: controller.signal.aborted ? "aborted" : "error",
          generationId: null,
          usage: null,
        })
      }
      return Response.json({ error: "Generation stopped." }, { status: 499 })
    }

    const created = await createIllustration({
      storyId: story.id,
      imageGroupId,
      prompt,
      derivedPrompt: null,
      modelId,
      aspectRatio,
      seed,
      mediaType: final.mediaType,
      b64: final.b64,
      // Handed in so the row and its price are joined in the same write the
      // picture is created by — nothing downstream has to reconcile them.
      callId,
    })

    if (!created.ok) {
      if (callId) {
        await settleCall(callId, {
          status: "error",
          generationId: null,
          usage: null,
        })
      }
      return Response.json({ error: created.error }, { status: 500 })
    }

    if (callId) {
      await settleCall(callId, {
        status: "ok",
        generationId: null,
        usage: {
          promptTokens: final.promptTokens ?? 0,
          completionTokens: final.completionTokens ?? 0,
          reasoningTokens: 0,
          costUsd: final.costUsd,
          cachedPromptTokens: null,
          upstreamPromptCostUsd: null,
          upstreamCompletionCostUsd: null,
          isByok: null,
        },
      })
    }

    return Response.json({ image: created.data })
  } catch (err) {
    if (callId) {
      await settleCall(callId, {
        status: controller.signal.aborted ? "aborted" : "error",
        generationId: null,
        usage: null,
      })
    }
    if (controller.signal.aborted) {
      return Response.json({ error: "Generation stopped." }, { status: 499 })
    }
    const message =
      err instanceof Error ? err.message : "The image request failed."
    return Response.json({ error: message }, { status: 502 })
  }
}
