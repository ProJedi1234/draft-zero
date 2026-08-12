// lib/generation/openrouter.ts — Server-only OpenRouter streaming core.
// The only module that feeds the key into the SDK for generation. Consumed by
// POST /api/generate; never import from client code ("server-only" enforces it).
import "server-only"

import { OpenRouterCore } from "@openrouter/sdk/core.js"
import { chatSend } from "@openrouter/sdk/funcs/chatSend.js"
import { EventStream } from "@openrouter/sdk/lib/event-streams.js"
import { OpenRouterError } from "@openrouter/sdk/models/errors"

import {
  endpointForTag,
  type GenerationSettings,
  type ModelEndpoint,
  type OpenRouterModel,
  type ReasoningEffort,
  type ThinkingLevel,
} from "@/lib/types"

import { renderPrompt } from "./context"
import { listModelEndpoints } from "./endpoints"
import { listModels } from "./models"
import { resolveSystemPrompt } from "./system-prompt"
import type { ComposedContext } from "./types"

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
      default:
        return {
          status: err.statusCode,
          message: "OpenRouter request failed. Try again.",
        }
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
 */
export function providerParam(
  endpoints: ModelEndpoint[],
  providerTag: string | null
): { only: string[]; allowFallbacks: boolean } | undefined {
  const endpoint = endpointForTag(endpoints, providerTag)
  if (!endpoint) return undefined
  return { only: [endpoint.tag], allowFallbacks: false }
}

/**
 * Streams a continuation. Two messages: the narrator instructions as a real
 * system turn, and renderPrompt(context) VERBATIM as the user turn — the same
 * pure function the ContextMeter uses, so the tokens the writer sees are the
 * tokens sent. Throws before the first yield for pre-stream errors (401, 402,
 * 429, ...) so the route can still answer with a JSON error status.
 */
export async function* streamCompletion(opts: {
  context: ComposedContext
  settings: GenerationSettings
  key: string
  signal: AbortSignal
}): AsyncGenerator<string> {
  const { context, settings, key, signal } = opts
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
  const provider = providerParam(endpoints, settings.providerTag)

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
          { role: "user", content: renderPrompt(context) },
        ],
        temperature: settings.temperature,
        topP: settings.topP,
        maxTokens: settings.maxTokens,
        frequencyPenalty: settings.frequencyPenalty,
        presencePenalty: settings.presencePenalty,
        seed: context.seed,
        reasoning,
        provider,
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

  for await (const chunk of res.value) {
    if (signal.aborted) return
    if (chunk.error) {
      throw new Error(chunk.error.message ?? "Provider error mid-stream")
    }
    // Reasoning deltas arrive on delta.reasoning and are deliberately dropped:
    // the manuscript only ever receives prose.
    const text = chunk.choices[0]?.delta.content
    if (typeof text === "string" && text !== "") yield text
  }
}
