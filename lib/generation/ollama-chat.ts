// lib/generation/ollama-chat.ts — Chat completions against the local Ollama
// host, server-only. The local half of openrouter.ts: same inputs, same
// GenerationEvents out, so the run loop, the summarizer and the atmosphere
// check cannot tell which backend answered.
//
// Native /api/chat rather than Ollama's OpenAI-compatible route, because only
// the native one takes num_ctx per request (see resolveOllamaContextWindow).
import "server-only"

import type { ThinkingLevel } from "@/lib/types"

import {
  hostLabel,
  invalidateOllamaCatalog,
  listOllamaChatModels,
  ollamaModelName,
  resolveOllamaBaseUrl,
  resolveOllamaContextWindow,
} from "./ollama"
import type { GenerationEvent, GenerationUsage } from "./types"

/** A local call that failed, worded for the writer who will read it in a toast. */
export class LocalModelError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = "LocalModelError"
  }
}

interface ChatChunk {
  message?: { content?: string; thinking?: string }
  done?: boolean
  done_reason?: string
  prompt_eval_count?: number
  eval_count?: number
  error?: string
}

interface ChatOptions {
  modelId: string
  system: string
  user: string
  thinking: ThinkingLevel
  temperature: number
  topP?: number
  frequencyPenalty?: number
  presencePenalty?: number
  seed?: number
  maxTokens?: number
  signal?: AbortSignal
}

function requireBaseUrl(): string {
  const baseUrl = resolveOllamaBaseUrl()
  if (!baseUrl) {
    throw new LocalModelError(
      "Local models aren't set up on this server. Pick another model.",
      503
    )
  }
  return baseUrl
}

/**
 * Ollama's `think` for a thinking level, or undefined to leave it off. Sending
 * it to a model without the capability is a 400, so the catalog decides.
 */
async function thinkParam(
  modelId: string,
  thinking: ThinkingLevel
): Promise<boolean | "low" | "medium" | "high" | undefined> {
  const model = (await listOllamaChatModels()).find((m) => m.id === modelId)
  if (!model?.reasoning) return undefined
  if (thinking === "off") return false
  // A model with a single level takes a plain on/off.
  if (model.reasoning.efforts.length === 1) return true
  if (thinking === "low" || thinking === "medium" || thinking === "high") {
    return thinking
  }
  return thinking === "minimal" ? "low" : "high"
}

async function postChat(opts: ChatOptions, stream: boolean): Promise<Response> {
  const baseUrl = requireBaseUrl()
  const host = hostLabel(baseUrl)
  const think = await thinkParam(opts.modelId, opts.thinking)
  let res: Response
  try {
    res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: ollamaModelName(opts.modelId),
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
        stream,
        ...(think === undefined ? {} : { think }),
        options: {
          num_ctx: resolveOllamaContextWindow(),
          temperature: opts.temperature,
          ...(opts.topP === undefined ? {} : { top_p: opts.topP }),
          ...(opts.frequencyPenalty === undefined
            ? {}
            : { frequency_penalty: opts.frequencyPenalty }),
          ...(opts.presencePenalty === undefined
            ? {}
            : { presence_penalty: opts.presencePenalty }),
          ...(opts.seed === undefined ? {} : { seed: opts.seed }),
          ...(opts.maxTokens === undefined
            ? {}
            : { num_predict: opts.maxTokens }),
        },
      }),
      signal: opts.signal,
    })
  } catch (err) {
    if (opts.signal?.aborted) throw err
    throw new LocalModelError(
      `${host} isn't answering. Check that Ollama is running, or pick another model.`,
      503
    )
  }
  if (!res.ok) throw await failure(res, opts.modelId, host)
  return res
}

async function failure(
  res: Response,
  modelId: string,
  host: string
): Promise<LocalModelError> {
  let detail = ""
  try {
    detail = ((await res.json()) as { error?: string }).error ?? ""
  } catch {
    // A body that isn't JSON says nothing the status doesn't.
  }
  if (res.status === 404) {
    invalidateOllamaCatalog()
    return new LocalModelError(
      `${ollamaModelName(modelId)} isn't installed on ${host} anymore. Pick another model.`,
      404
    )
  }
  // Ollama's own sentence is the useful part here ("model requires more system
  // memory…"), and it never carries anything secret.
  return new LocalModelError(
    detail
      ? `${host} couldn't run the model: ${detail}`
      : `${host} couldn't run the model. Try again.`,
    res.status
  )
}

/** Local calls are free; a zero here is a fact rather than a missing price. */
function toUsage(chunk: ChatChunk): GenerationUsage {
  return {
    promptTokens: chunk.prompt_eval_count ?? 0,
    completionTokens: chunk.eval_count ?? 0,
    reasoningTokens: 0,
    costUsd: 0,
    cachedPromptTokens: null,
    upstreamPromptCostUsd: null,
    upstreamCompletionCostUsd: null,
    isByok: null,
  }
}

/** NDJSON lines from a fetch body, buffered across arbitrary chunk boundaries. */
async function* ndjson(body: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder()
  let buffer = ""
  for await (const bytes of body) {
    buffer += decoder.decode(bytes, { stream: true })
    let newline = buffer.indexOf("\n")
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (line !== "") yield JSON.parse(line) as ChatChunk
      newline = buffer.indexOf("\n")
    }
  }
  const tail = buffer.trim()
  if (tail !== "") yield JSON.parse(tail) as ChatChunk
}

/**
 * Streams a local completion as GenerationEvents. Throws LocalModelError before
 * the first yield for a host that isn't answering or a model that's gone, so
 * the run loop ends the run before it opens a ledger row.
 *
 * No meta event: a local call has no generation id to reconcile against.
 */
export async function* streamOllamaCompletion(
  opts: ChatOptions & { signal: AbortSignal }
): AsyncGenerator<GenerationEvent> {
  const res = await postChat(opts, true)
  if (!res.body) throw new LocalModelError("The local model sent nothing.", 502)
  for await (const chunk of ndjson(res.body)) {
    if (opts.signal.aborted) return
    if (chunk.error) throw new LocalModelError(chunk.error, 500)
    const thinking = chunk.message?.thinking
    if (thinking) yield { type: "reasoning", chars: thinking.length }
    const text = chunk.message?.content
    if (text) yield { type: "text", value: text }
    if (chunk.done) yield { type: "usage", usage: toUsage(chunk) }
  }
}

/** One non-streaming local completion, the local half of completeOnce. */
export async function completeOllamaOnce(opts: ChatOptions): Promise<{
  text: string
  truncated: boolean
  generationId: string | null
  usage: GenerationUsage | null
}> {
  const res = await postChat(opts, false)
  const chunk = (await res.json()) as ChatChunk
  if (chunk.error) throw new LocalModelError(chunk.error, 500)
  return {
    text: chunk.message?.content ?? "",
    truncated: chunk.done_reason === "length",
    generationId: null,
    usage: toUsage(chunk),
  }
}
