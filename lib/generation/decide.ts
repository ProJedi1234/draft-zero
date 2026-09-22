// lib/generation/decide.ts — One call to a decision model, server-only.
//
// The sibling of completeOnce in openrouter.ts, for the other kind of provider
// call this app makes. A decision model is not a chat model with a short
// answer: OpenRouter lists `typesafe/jev-1.13` with an EMPTY supported-parameter
// set, so there is no temperature to send, no thinking to ask for and no
// messages array to put them in. It has its own route.
//
// Hand-rolled fetch rather than the SDK, and only for a version reason.
// `@openrouter/sdk` gained `systemOne.create` in 1.3.0; this app is pinned to
// 1.2.25, which the whole streaming generation path is built on. Upgrading the
// SDK to reach one method is a change to every call in the app, so the twenty
// lines below buy the feature without touching any of them. When the SDK moves
// for its own reasons, this becomes `openRouter.systemOne.create(...)` and the
// zod schema below becomes its response type.
import "server-only"

import { z } from "zod"

import type {
  DecisionQuestion,
  DecisionResult,
  GenerationUsage,
} from "@/lib/generation/types"

/**
 * The stable route. OpenRouter serves the identical protocol at
 * `/api/alpha/decisions`, which is explicitly labelled alpha and sits outside
 * the versioned prefix, so this is the one to build on.
 *
 * The `/api` segment is not optional and its absence does not fail loudly:
 * `openrouter.ai/v1/systemone` answers 200 with the marketing site's HTML,
 * which reaches a JSON parser as a syntax error rather than as a 404.
 */
const SYSTEM_ONE_URL = "https://openrouter.ai/api/v1/systemone"

/** How long one decision may take. Far under a completion's — p95 is ~230ms. */
const DECISION_TIMEOUT_MS = 15_000

/**
 * A decision call that did not produce answers.
 *
 * Its own class so callers can tell a provider that refused from a bug in the
 * code that called it, and so the message can be written for the writer who
 * will read it in a toast rather than for a log.
 */
export class DecisionError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null
  ) {
    super(message)
    this.name = "DecisionError"
  }
}

const NoulAnswerSchema = z.object({
  type: z.literal("noul"),
  noul: z.number(),
})

const ChoiceAnswerSchema = z.object({
  type: z.literal("choice"),
  choice: z.string(),
  confidence: z.number().optional(),
  probabilities: z.record(z.string(), z.number()).optional(),
})

const ScoreAnswerSchema = z.object({
  type: z.literal("score"),
  score: z.number(),
  confidence: z.number().optional(),
  legend: z.record(z.string(), z.unknown()).optional(),
  probabilities: z.record(z.string(), z.number()).optional(),
})

/**
 * The wire reply, in the provider's snake_case.
 *
 * Strict about the answer shapes and loose about everything around them: an
 * unrecognised top-level field is OpenRouter adding something, while an answer
 * that is not one of these three is an answer this app cannot act on.
 */
const DecisionResponseSchema = z.object({
  id: z.string().optional(),
  answers: z.record(
    z.string(),
    z.discriminatedUnion("type", [
      NoulAnswerSchema,
      ChoiceAnswerSchema,
      ScoreAnswerSchema,
    ])
  ),
  usage: z
    .object({
      input_tokens: z.number(),
      output_tokens: z.number(),
      cost: z.number().optional(),
    })
    .optional(),
})

/**
 * Ask a decision model a set of questions about one piece of state.
 *
 * Every question is answered in ONE call and evaluated in parallel by the
 * provider, which is the whole reason the caller should batch rather than loop:
 * a second question costs its own tokens and almost no additional latency,
 * where a second call costs both again. `state` carries the thing being judged
 * and nothing else — the provider's guidance is that instructions belong in the
 * questions, and state that argues for an answer is state that skews it.
 *
 * Throws DecisionError on anything that is not a parseable set of answers.
 * There is no partial success: a reply missing the question that was asked is
 * a failed call, because a caller that wanted half an answer would not have
 * asked for the other half.
 */
export async function decideOnce(opts: {
  state: Record<string, unknown>
  questions: Record<string, DecisionQuestion>
  /** The caller's pinned decision model — this module has no default. */
  modelId: string
  zdr: boolean
  key: string
  signal?: AbortSignal
}): Promise<DecisionResult> {
  const timeout = AbortSignal.timeout(DECISION_TIMEOUT_MS)
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout

  let res: Response
  try {
    res = await fetch(SYSTEM_ONE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.key}`,
        "Content-Type": "application/json",
        "X-Title": "draft-zero",
      },
      body: JSON.stringify({
        model: opts.modelId,
        state: opts.state,
        questions: opts.questions,
        // The provider block carries retention policy and nothing else here.
        // Jev is served by exactly one provider, so there is no routing to
        // express — but the ZDR flag still has to be sent, because a request
        // that omits it is a request that permits retention.
        ...(opts.zdr ? { provider: { zdr: true } } : {}),
      }),
      signal,
    })
  } catch (err) {
    if (timeout.aborted) {
      throw new DecisionError("The decision model didn't answer in time.")
    }
    // A caller-side abort is not a failure to report — it is the caller
    // deciding it no longer wants the answer — so it is rethrown as itself.
    throw err
  }

  if (!res.ok) throw new DecisionError(describeFailure(res), res.status)

  const parsed = DecisionResponseSchema.safeParse(await res.json())
  if (!parsed.success) {
    throw new DecisionError("The decision model sent an answer we can't read.")
  }

  return {
    answers: parsed.data.answers,
    generationId: parsed.data.id ?? null,
    usage: toUsage(parsed.data.usage),
  }
}

/**
 * The provider's error, as a sentence a writer can act on.
 *
 * The status alone, deliberately — the response body is provider JSON written
 * for a log, and on every failure a writer can actually do something about it
 * says less than the code already does. Same map and same wording as
 * mapOpenRouterError, because the two routes fail for the same reasons and a
 * writer should not be able to tell which one was in play.
 */
function describeFailure(res: Response): string {
  switch (res.status) {
    case 401:
      return "OpenRouter rejected the API key. Check Settings."
    case 402:
      return "OpenRouter credits exhausted. Top up your account."
    case 404:
      // The decision model has exactly one provider, so the only way to ask for
      // an endpoint that does not exist is to require one it cannot satisfy.
      return "No provider for the decision model keeps nothing. Turn off zero data retention, or use a language model for this."
    case 429:
      return "OpenRouter rate limit hit. Wait a moment and retry."
    default:
      return "The decision model is unavailable. Try again."
  }
}

/**
 * Provider usage → the app's own, so a decision row and a completion row are
 * the same row to everything downstream.
 *
 * Output tokens are counted and billed at zero, which is real rather than a
 * gap: the model emits a probability vector, not text. They are carried
 * through anyway — the ledger's job is to record what happened, and a column
 * of zeroes is a true statement about a decision call.
 */
function toUsage(
  usage:
    { input_tokens: number; output_tokens: number; cost?: number } | undefined
): GenerationUsage | null {
  if (!usage) return null
  return {
    promptTokens: usage.input_tokens,
    completionTokens: usage.output_tokens,
    // No reasoning, no prompt caching and no BYOK on this route. Null rather
    // than a fabricated zero for the last two: "not applicable" and "none"
    // read the same on the usage page, and only one of them is true.
    reasoningTokens: 0,
    costUsd: usage.cost ?? null,
    cachedPromptTokens: null,
    upstreamPromptCostUsd: null,
    upstreamCompletionCostUsd: null,
    isByok: null,
  }
}
