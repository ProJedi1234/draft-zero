// POST /api/image-prompt — derive an image prompt for where the story is now.
//
// A route rather than a server action because the answer STREAMS: the composer
// shows the prompt writing itself, and a server action can only resolve once.
// Small enough to own its whole lifecycle here — unlike a story generation,
// nothing needs to survive the tab closing, since an abandoned prompt is worth
// nothing and the writer can ask again for a fraction of a cent.
import { getAppSettings, listLorebookEntries, getStory } from "@/lib/db/queries"
import { composeContext } from "@/lib/generation/context"
import { LORE_BUDGET_MAX } from "@/lib/types"
import { recordCallStarted, settleCall } from "@/lib/generation/calls"
import { resolveOpenRouterKey } from "@/lib/generation/key"
import { mapOpenRouterError } from "@/lib/generation/openrouter"
import { streamDerivation } from "@/lib/images/derive-live"
import { deriveImagePrompt } from "@/lib/images/derive-prompt"
import { chunkText } from "@/lib/generation/fixtures"

export const runtime = "nodejs"

/**
 * The derivation's own context budget — deliberately NOT the story's window.
 *
 * This call has been at both extremes. It started at 2,048 tokens with the
 * summary silently dropped, which is where character continuity went to die:
 * anyone last described outside the slice was re-invented every derivation.
 * The fix swung to the story's full window, which over-corrected — a
 * description of one visible moment does not need six thousand tokens of
 * manuscript, and past a point the extra prose actively dilutes the scene
 * toward the story's average.
 *
 * What the swing taught is that continuity never lived in the raw window: it
 * lives in the SUMMARY (fixed overhead, always rides) and the LORE. So the
 * budget is small and lore-heavy: 4,096 tokens with lore allowed its maximum
 * share, which after the measured overhead, memory and summary leaves roughly
 * one to two thousand tokens of recent manuscript — the moment and its
 * immediate approach, not the book. composeContext returns lore's unspent
 * share to prose, so the split self-balances per story.
 *
 * App-wide rather than per story — a derivation budget is a property of how
 * the image feature works, not of any one manuscript — and configured on the
 * settings page (app_settings.image_context_tokens) beside the default image
 * model, with 4,096 as the shipped default.
 */

export async function POST(req: Request): Promise<Response> {
  let storyId: string
  try {
    const body = (await req.json()) as { storyId?: unknown }
    if (typeof body.storyId !== "string" || body.storyId === "") {
      return Response.json({ error: "storyId is required." }, { status: 400 })
    }
    storyId = body.storyId
  } catch {
    return Response.json({ error: "Malformed request." }, { status: 400 })
  }

  const [story, lorebookEntries, appSettings] = await Promise.all([
    getStory(storyId),
    listLorebookEntries(storyId),
    getAppSettings(),
  ])
  if (!story) {
    return Response.json({ error: "Story not found." }, { status: 404 })
  }
  if (story.entries.length === 0) {
    // Nothing to describe yet. An honest refusal beats spending a call to have
    // a model invent an opening scene the story has not written.
    return Response.json(
      { error: "Write something first — there's no scene to describe yet." },
      { status: 409 }
    )
  }

  const context = composeContext({
    story,
    lorebookEntries,
    variant: 0,
    contextWindow: appSettings.imageContextTokens,
    // Lore's ceiling, not its floor: composeContext hands lore's unspent share
    // back to story prose, so a lore-light story gets its space back for free.
    loreBudget: LORE_BUDGET_MAX,
  })

  const key = resolveOpenRouterKey()
  const encoder = new TextEncoder()

  // Offline: the keyword stand-in, streamed the same way so the composer cannot
  // tell the two apart and nothing downstream has a second code path. It costs
  // nothing and records nothing — see lib/images/derive-prompt.ts.
  if (!key) {
    const text = deriveImagePrompt(context.storyText, context.approxTokens)
    return new Response(
      new ReadableStream<Uint8Array>({
        async start(controller) {
          for (const chunk of chunkText(text, 2)) {
            controller.enqueue(encoder.encode(chunk))
            await new Promise((resolve) => setTimeout(resolve, 40))
          }
          controller.close()
        },
      }),
      { headers: { "Content-Type": "text/plain; charset=utf-8" } }
    )
  }

  const callId = crypto.randomUUID()
  await recordCallStarted({
    id: callId,
    storyId: story.id,
    origStoryId: story.id,
    storyTitle: story.title,
    // Its own kind, so image-prompt spend is separable from prose spend on the
    // usage page rather than quietly inflating "generate".
    requestKind: "illustrate-prompt",
    modelId: story.settings.modelId,
    // Forced off in streamDerivation, and recorded as what actually happened
    // rather than as what the story's settings say.
    thinking: "off",
    providerName: story.settings.providerTag,
  })

  const controllerAbort = new AbortController()
  // The client hanging up should stop the call, not just stop us reading it —
  // and since 417441a removed the token ceiling, what sits on the other side of
  // a closed tab is an unbounded completion rather than a bounded 160 of them.
  req.signal.addEventListener("abort", () => controllerAbort.abort(), {
    once: true,
  })

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let settled = false
      try {
        for await (const event of streamDerivation({
          context,
          settings: story.settings,
          key,
          signal: controllerAbort.signal,
        })) {
          if (event.type === "text" && event.value) {
            controller.enqueue(encoder.encode(event.value))
          } else if (event.type === "done") {
            settled = true
            await settleCall(callId, {
              status: controllerAbort.signal.aborted ? "aborted" : "ok",
              generationId: event.generationId ?? null,
              usage: {
                promptTokens: event.promptTokens ?? 0,
                completionTokens: event.completionTokens ?? 0,
                reasoningTokens: 0,
                costUsd: event.costUsd ?? null,
                cachedPromptTokens: null,
                upstreamPromptCostUsd: null,
                upstreamCompletionCostUsd: null,
                isByok: null,
              },
            })
          }
        }
        // Aborted before the final chunk: real tokens were billed and no usage
        // ever arrived, so the row settles with a NULL cost rather than a zero.
        // reconcileCall can still fill it in later from the generation id.
        if (!settled) {
          await settleCall(callId, {
            status: controllerAbort.signal.aborted ? "aborted" : "ok",
            generationId: null,
            usage: null,
          })
        }
      } catch (err) {
        await settleCall(callId, {
          status: "error",
          generationId: null,
          usage: null,
        })
        const { message } = mapOpenRouterError(err)
        // The stream has already started, so an error cannot become a status
        // code — it goes down the pipe as text the composer shows in a toast.
        controller.enqueue(encoder.encode(` ${message}`))
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  })
}
