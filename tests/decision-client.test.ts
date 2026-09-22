// tests/decision-client.test.ts — The decision-model client's failure contract.
//
// decideOnce promises callers one thing about going wrong: everything that is
// not the caller's own abort arrives as a DecisionError carrying a sentence
// written for a writer. The runner in atmosphere.ts is built on that promise —
// it routes a DecisionError straight to a toast and sends anything else
// through mapOpenRouterError, which has never heard of this route and flattens
// it to the generic line. So a raw TypeError or SyntaxError escaping here is
// not a crash, it is a writer told nothing useful, which is the kind of bug
// that survives for months.
//
// The happy path is here as a control, and for the one request-shape assertion
// that has teeth: a request that omits the ZDR flag is a request that permits
// retention.

import { afterEach, describe, expect, mock, test } from "bun:test"

import type { DecisionQuestion } from "@/lib/generation/types"

// `server-only` throws on import outside a React Server Component graph, and
// the module under test imports it on purpose.
mock.module("server-only", () => ({}))

const { decideOnce, DecisionError } = await import("@/lib/generation/decide")

// The dynamic import is what keeps the mock above in front of it, and a
// destructured class binding is a value only — this is its type.
type Refusal = InstanceType<typeof DecisionError>

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

const QUESTIONS: Record<string, DecisionQuestion> = {
  fits: {
    type: "noul",
    instructions: "Does the tint still fit?",
    criteria: { true: "it fits", false: "it does not" },
  },
}

/** The arguments decideOnce always needs, minus whatever a test is varying. */
function call(overrides: { signal?: AbortSignal; zdr?: boolean } = {}) {
  return decideOnce({
    state: { tail: "the room went quiet" },
    questions: QUESTIONS,
    modelId: "typesafe/jev-1.13",
    zdr: overrides.zdr ?? false,
    key: "sk-test",
    signal: overrides.signal,
  })
}

/** A fetch that honours the abort signal, as the real one does, then defers. */
function stubFetch(
  handler: (init: RequestInit) => Response | Promise<Response>
) {
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    const signal = init.signal as AbortSignal | undefined
    if (signal?.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError")
    }
    return handler(init)
  }) as unknown as typeof fetch
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

describe("decideOnce failures", () => {
  test("a dead connection is a DecisionError, not a raw fetch rejection", async () => {
    stubFetch(() => {
      throw new TypeError("fetch failed")
    })

    const err = await call().catch((e: unknown) => e)

    expect(err).toBeInstanceOf(DecisionError)
    expect((err as Refusal).message).toBe(
      "The decision model is unavailable. Try again."
    )
  })

  test("a 200 carrying HTML is unreadable rather than a SyntaxError", async () => {
    // The documented trap: openrouter.ai/v1/systemone, without the /api
    // segment, answers 200 with the marketing site. It fails at the parser.
    stubFetch(
      () =>
        new Response("<!doctype html><title>OpenRouter</title>", {
          status: 200,
          headers: { "Content-Type": "text/html" },
        })
    )

    const err = await call().catch((e: unknown) => e)

    expect(err).toBeInstanceOf(DecisionError)
    expect((err as Refusal).message).toBe(
      "The decision model sent an answer we can't read."
    )
  })

  test("JSON that is not answers is unreadable too", async () => {
    stubFetch(() => json({ answers: { fits: { type: "vibes", noul: 0.5 } } }))

    const err = await call().catch((e: unknown) => e)

    expect(err).toBeInstanceOf(DecisionError)
    expect((err as Refusal).message).toBe(
      "The decision model sent an answer we can't read."
    )
  })

  test("a refused status keeps its number and its own sentence", async () => {
    stubFetch(() => json({ error: { message: "no auth" } }, 401))

    const err = await call().catch((e: unknown) => e)

    expect(err).toBeInstanceOf(DecisionError)
    expect((err as Refusal).status).toBe(401)
    expect((err as Refusal).message).toBe(
      "OpenRouter rejected the API key. Check Settings."
    )
  })

  test("a caller's own abort is rethrown as itself", async () => {
    // Not a failure to report — the caller stopped wanting the answer, and
    // dressing that up as a DecisionError puts a toast on a navigation.
    stubFetch(() => json({ answers: {} }))
    const controller = new AbortController()
    controller.abort()

    const err = await call({ signal: controller.signal }).catch(
      (e: unknown) => e
    )

    expect(err).not.toBeInstanceOf(DecisionError)
    expect((err as Error).name).toBe("AbortError")
  })
})

describe("decideOnce success", () => {
  test("answers, generation id and usage come back mapped", async () => {
    stubFetch(() =>
      json({
        id: "gen-77",
        answers: { fits: { type: "noul", noul: 0.82 } },
        usage: { input_tokens: 412, output_tokens: 0, cost: 0.0000031 },
      })
    )

    const result = await call()

    expect(result.answers.fits).toEqual({ type: "noul", noul: 0.82 })
    expect(result.generationId).toBe("gen-77")
    expect(result.usage?.promptTokens).toBe(412)
    expect(result.usage?.completionTokens).toBe(0)
    expect(result.usage?.costUsd).toBe(0.0000031)
    // Not applicable on this route, and null says so where 0 would lie.
    expect(result.usage?.cachedPromptTokens).toBeNull()
    expect(result.usage?.isByok).toBeNull()
  })

  test("zero data retention rides on the request or it is not in force", async () => {
    let sent: Record<string, unknown> = {}
    stubFetch((init) => {
      sent = JSON.parse(init.body as string)
      return json({ answers: { fits: { type: "noul", noul: 0.5 } } })
    })

    await call({ zdr: true })
    expect(sent.provider).toEqual({ zdr: true })

    await call({ zdr: false })
    expect(sent.provider).toBeUndefined()
  })
})
