// lib/generation/openrouter.ts — Server-only OpenRouter streaming core.
// The only module that feeds the key into the SDK for generation. Consumed by
// the run loop in lib/generation/live.ts; never import from client code
// ("server-only" enforces it).
import "server-only"

import { OpenRouterCore } from "@openrouter/sdk/core.js"
import { chatSend } from "@openrouter/sdk/funcs/chatSend.js"
import { EventStream } from "@openrouter/sdk/lib/event-streams.js"
import { OpenRouterError } from "@openrouter/sdk/models/errors"

import {
  routableEndpointForTag,
  type GenerationSettings,
  type ModelEndpoint,
  type OpenRouterModel,
  type ReasoningEffort,
  type ThinkingLevel,
} from "@/lib/types"

import { promptSegments, renderPrompt } from "./context"
import { listModelEndpoints } from "./endpoints"
import { listModels } from "./models"
import { resolveSystemPrompt } from "./system-prompt"
import type { ComposedContext, GenerationEvent, GenerationUsage } from "./types"
import { isDataPolicyRefusal } from "./zdr-account"

/** Maps SDK/stream errors to { status, message } safe to show the writer. */
export function mapOpenRouterError(err: unknown): {
  status: number
  message: string
} {
  if (err instanceof OpenRouterError) {
    switch (err.statusCode) {
      case 401:
        return {
          status: 401,
          message: "OpenRouter rejected the API key. Check Settings.",
        }
      case 402:
        return {
          status: 402,
          message: "OpenRouter credits exhausted. Top up your account.",
        }
      case 404:
        // The one 404 a writer can act on: no endpoint of this model satisfies
        // the data policy in force, which is either theirs or their OpenRouter
        // account's. Any other 404 falls through to the generic message.
        if (isDataPolicyRefusal(err)) {
          return {
            status: 404,
            message:
              "No provider for this model keeps nothing. Pick another model, or turn off zero data retention.",
          }
        }
        break
      case 429:
        return {
          status: 429,
          message: "OpenRouter rate limit hit. Wait a moment and retry.",
        }
      case 502:
      case 503:
        return {
          status: 503,
          message:
            "The model provider is unavailable. Try again or switch models.",
        }
    }
    return {
      status: err.statusCode,
      message: "OpenRouter request failed. Try again.",
    }
  }
  return { status: 500, message: "Generation failed. Try again." }
}

/**
 * The `reasoning` block for a request, or undefined to leave it off the wire.
 *
 * It is only ever sent to a model the catalog says can think — a plain model
 * rejects the parameter outright. "off" is sent as `effort: "none"` so models
 * that think by default (Gemini 3, GPT-5.x) actually stop, except where the
 * catalog marks reasoning mandatory: there "none" is a 400, so the request
 * omits the block and takes the provider's own default.
 */
export function reasoningParam(
  model: OpenRouterModel | undefined,
  thinking: ThinkingLevel
): { effort: ReasoningEffort | "none" } | undefined {
  if (!model?.reasoning) return undefined
  if (thinking === "off") {
    return model.reasoning.mandatory ? undefined : { effort: "none" }
  }
  return { effort: thinking }
}

/**
 * The `provider` block for a request, or undefined to let OpenRouter route.
 *
 * A pinned endpoint is sent as `only` with fallbacks off: the writer picked that
 * provider for its speed, price or quantization, and silently serving the
 * request from a different one would make the picker a decoration. A tag that is
 * no longer in the model's endpoint list is dropped back to Auto rather than
 * sent — endpoints come and go, and a stale row should cost a writer a different
 * provider, not a failed generation.
 *
 * A pin that names an endpoint which retains prompts is dropped the same way
 * when `zdr` is on, for the same reason: the two settings can only disagree
 * because one of them changed after the other was set, and the writer's data
 * policy is the one that has to win. OpenRouter would refuse the pair outright
 * (404, "No endpoints found matching your data policy"), so honouring the pin
 * would not even get the writer the provider they asked for.
 */
export function providerParam(
  endpoints: ModelEndpoint[],
  providerTag: string | null,
  zdr: boolean
): { only?: string[]; allowFallbacks?: boolean; zdr?: true } | undefined {
  const endpoint = routableEndpointForTag(endpoints, providerTag, zdr)
  if (!endpoint) return zdr ? { zdr: true } : undefined
  return {
    only: [endpoint.tag],
    allowFallbacks: false,
    ...(zdr ? { zdr: true as const } : {}),
  }
}

/**
 * The user turn as content parts, with cache breakpoints on the stable ones.
 *
 * Concatenating the parts gives renderPrompt(context) byte for byte — that is
 * asserted in tests/context-caching.test.ts — so splitting the turn up changes
 * what the PROVIDER is asked to remember and nothing about what the model
 * reads. The breakpoints go on the head (memory + always-on and
 * memory-triggered lore) and on the manuscript head, both of which are stable
 * from one turn to the next; the tail is left unmarked because it is expected
 * to differ every turn.
 *
 * Providers that cache implicitly (OpenAI, Gemini 2.5+, DeepSeek, Grok) ignore
 * the annotation and simply benefit from the stable prefix. Providers that need
 * explicit breakpoints (Anthropic, Qwen) read them. A provider that understands
 * neither sees ordinary text parts.
 */
function userContent(
  context: ComposedContext
):
  | string
  | { type: "text"; text: string; cacheControl?: { type: "ephemeral" } }[] {
  const segments = promptSegments(context)
  // A single unmarked segment is just a string — no reason to send the more
  // elaborate shape when there is nothing to annotate.
  if (!segments.some((segment) => segment.cache)) return renderPrompt(context)
  return segments.map((segment) => ({
    type: "text" as const,
    text: segment.text,
    ...(segment.cache ? { cacheControl: { type: "ephemeral" as const } } : {}),
  }))
}

/**
 * One non-streaming completion, for work the writer never watches.
 *
 * Deliberately not built on streamCompletion: nothing here is rendered as it
 * arrives, so streaming would buy latency the caller cannot use and would cost
 * the abort-safety bookkeeping the run loop needs. What it keeps is the parts
 * that are about money and policy — the generation id (the only handle that can
 * ever ask OpenRouter what a call cost) and the usage block.
 *
 * Routing and reasoning are resolved exactly as streamCompletion resolves them
 * — same catalogs, same providerParam, same reasoningParam — because a pinned
 * provider and a thinking level mean the same thing whoever is asking. In
 * particular `zdr` is the fail-closed half of the retention rule: with no
 * routable pin the request carries `{ zdr: true }` and OpenRouter answers a 404
 * rather than routing to a host that retains prompts. That 404 is a refusal,
 * not a fault — the caller treats it as "wrote nothing", which is correct.
 */
export async function completeOnce(opts: {
  system: string
  user: string
  modelId: string
  thinking: ThinkingLevel
  providerTag: string | null
  temperature: number
  maxTokens: number
  zdr: boolean
  key: string
  signal?: AbortSignal
}): Promise<{
  text: string
  /** The provider stopped at maxTokens — the tail of the answer is missing. */
  truncated: boolean
  generationId: string | null
  usage: GenerationUsage | null
}> {
  const core = new OpenRouterCore({ apiKey: opts.key, appTitle: "draft-zero" })
  // Both catalogs are cached per process, so these are lookups rather than
  // round-trips. The endpoint list is only needed when a provider is pinned.
  const [models, endpoints] = await Promise.all([
    listModels(),
    opts.providerTag === null
      ? Promise.resolve<ModelEndpoint[]>([])
      : listModelEndpoints(opts.modelId),
  ])
  const res = await chatSend(
    core,
    {
      chatRequest: {
        model: opts.modelId,
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
        temperature: opts.temperature,
        maxTokens: opts.maxTokens,
        reasoning: reasoningParam(
          models.find((model) => model.id === opts.modelId),
          opts.thinking
        ),
        provider: providerParam(endpoints, opts.providerTag, opts.zdr),
        stream: false,
      },
    },
    opts.signal ? { signal: opts.signal } : undefined
  )
  if (!res.ok) throw res.error
  if (res.value instanceof EventStream) {
    throw new Error("OpenRouter streamed a response that was not asked to")
  }

  const result = res.value
  const choice = result.choices[0]
  const content = choice?.message.content
  // The content union allows structured parts; a summarizer never produces
  // them, and silently stringifying an unexpected shape would put JSON in the
  // manuscript's memory. Empty is handled by the caller as "wrote nothing".
  const text = typeof content === "string" ? content : ""
  const usage = result.usage
  return {
    text,
    truncated: choice?.finishReason === "length",
    generationId: result.id ?? null,
    usage: usage
      ? {
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          reasoningTokens: usage.completionTokensDetails?.reasoningTokens ?? 0,
          costUsd: usage.cost ?? null,
          cachedPromptTokens: usage.promptTokensDetails?.cachedTokens ?? null,
          upstreamPromptCostUsd:
            usage.costDetails?.upstreamInferencePromptCost ?? null,
          upstreamCompletionCostUsd:
            usage.costDetails?.upstreamInferenceCompletionsCost ?? null,
          isByok: usage.isByok ?? null,
        }
      : null,
  }
}

/**
 * Streams a continuation as GenerationEvents. Two messages: the narrator
 * instructions as a real system turn, and the composed context as the user
 * turn — split into cache-annotated parts that concatenate back to
 * renderPrompt(context) exactly, so the tokens the writer sees in the meter are
 * still the tokens sent. Throws before the first yield for pre-stream errors
 * (401, 402, 429, ...) so the run loop can end the run with a real message
 * before any ledger row exists.
 */
export async function* streamCompletion(opts: {
  context: ComposedContext
  settings: GenerationSettings
  key: string
  signal: AbortSignal
  /**
   * The story, used only as OpenRouter's `session_id`: it pins a story's
   * requests to one upstream provider so the cache written on the last turn is
   * still there to read on this one. Auto routing is otherwise free to move
   * between equivalent endpoints, and a cache entry does not follow.
   */
  sessionId?: string
}): AsyncGenerator<GenerationEvent> {
  const { context, settings, key, signal, sessionId } = opts
  const core = new OpenRouterCore({ apiKey: key, appTitle: "draft-zero" })
  // Both catalogs are cached per process, so these are lookups rather than
  // round-trips on the hot path. The endpoint list is only needed when the story
  // actually pins a provider.
  const [models, endpoints] = await Promise.all([
    listModels(),
    settings.providerTag === null
      ? Promise.resolve<ModelEndpoint[]>([])
      : listModelEndpoints(settings.modelId),
  ])
  const reasoning = reasoningParam(
    models.find((m) => m.id === settings.modelId),
    settings.thinking
  )
  const provider = providerParam(endpoints, settings.providerTag, settings.zdr)

  const res = await chatSend(
    core,
    {
      chatRequest: {
        model: settings.modelId,
        messages: [
          // Re-resolved rather than trusted: the context arrives over the wire
          // from the client, so a stale or hand-edited body must not be able to
          // send an empty system turn.
          {
            role: "system",
            content: resolveSystemPrompt(context.systemPrompt),
          },
          { role: "user", content: userContent(context) },
        ],
        temperature: settings.temperature,
        topP: settings.topP,
        // No maxTokens, deliberately. Omitting it IS the model's own ceiling,
        // which is the honest ceiling to run under: passage length is the
        // system prompt's job, and a numeric cap on top of it only ever fired
        // as a mid-sentence truncation — or, on a reasoning model, against the
        // thinking instead of the prose, returning nothing at all.
        frequencyPenalty: settings.frequencyPenalty,
        presencePenalty: settings.presencePenalty,
        seed: context.seed,
        reasoning,
        provider,
        ...(sessionId ? { sessionId } : {}),
        stream: true,
      },
    },
    { signal }
  )
  if (!res.ok) throw res.error
  // stream: true → the union narrows to the streaming half at runtime.
  if (!(res.value instanceof EventStream)) {
    throw new Error("OpenRouter returned a non-streaming response")
  }

  // OpenRouter's id for this generation, repeated on every chunk. Yielded once,
  // from the first chunk that carries it, and deliberately BEFORE any prose:
  // the writer can press Stop between two deltas, and after that this handle is
  // the only way left to ask what the call cost. Capturing it at the end would
  // capture it exactly never on the path that needs it most.
  let generationId: string | null = null

  for await (const chunk of res.value) {
    if (signal.aborted) return
    if (chunk.error) {
      throw new Error(chunk.error.message ?? "Provider error mid-stream")
    }

    if (generationId === null && chunk.id) {
      generationId = chunk.id
      // callId stays null down here on purpose: the run loop owns the ledger
      // row, and this module does not know the ledger exists.
      yield { type: "meta", generationId, callId: null }
    }

    // Reasoning deltas are still never forwarded as text — the manuscript only
    // ever receives prose. What travels is their LENGTH, which is enough for the
    // canvas to show that the model is thinking rather than stalled, and not
    // enough to reconstruct a word of what it thought.
    const reasoning = chunk.choices[0]?.delta.reasoning
    if (typeof reasoning === "string" && reasoning !== "") {
      yield { type: "reasoning", chars: reasoning.length }
    }

    const text = chunk.choices[0]?.delta.content
    if (typeof text === "string" && text !== "") {
      yield { type: "text", value: text }
    }

    // Usage rides the final chunk and only the final chunk (OpenRouter sends it
    // once, after the last delta), so this is the one place exact counts exist.
    // Everything the UI shows before it is an estimate and has to look like one.
    //
    // The cost fields ride along with them. No request flag turns them on:
    // `stream_options.include_usage` is a deprecated no-op in this SDK ("full
    // usage details are always included"). Every one of them is nullable and
    // stays null when absent — an unpriced call is a fact worth recording, and a
    // zero would sum silently into a total the writer checks against a balance.
    if (chunk.usage) {
      yield {
        type: "usage",
        usage: {
          promptTokens: chunk.usage.promptTokens,
          completionTokens: chunk.usage.completionTokens,
          reasoningTokens:
            chunk.usage.completionTokensDetails?.reasoningTokens ?? 0,
          costUsd: chunk.usage.cost ?? null,
          cachedPromptTokens:
            chunk.usage.promptTokensDetails?.cachedTokens ?? null,
          upstreamPromptCostUsd:
            chunk.usage.costDetails?.upstreamInferencePromptCost ?? null,
          upstreamCompletionCostUsd:
            chunk.usage.costDetails?.upstreamInferenceCompletionsCost ?? null,
          isByok: chunk.usage.isByok ?? null,
        },
      }
    }
  }
}
