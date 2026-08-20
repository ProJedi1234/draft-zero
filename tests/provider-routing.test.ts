// tests/provider-routing.test.ts — Which provider serves a generation.
//
// Two layers, both pinned here. The pure half: resolving a stored endpoint tag
// and the two readouts the picker menu prints (providerParam in
// lib/generation/openrouter.ts is a two-line wrapper over endpointForTag). And
// the run loop's resolution: real streamCompletion iff a key exists, the
// offline mock otherwise — decided entirely server-side, in the loop, because
// the client no longer holds a provider at all.

import { beforeEach, describe, expect, mock, test } from "bun:test"

import { formatThroughput, formatUptime } from "@/lib/format"
import type { GenerationEvent } from "@/lib/generation/types"
import { endpointForTag, type ModelEndpoint } from "@/lib/types"

// See generation-calls.test.ts for why "server-only" must be neutralised.
mock.module("server-only", () => ({}))

let currentKey: string | null = null
mock.module("@/lib/generation/key", () => ({
  resolveOpenRouterKey: () => currentKey,
}))

const streamCalls: Array<{ key: string }> = []
mock.module("@/lib/generation/openrouter", () => ({
  streamCompletion: (opts: { key: string }) => {
    streamCalls.push({ key: opts.key })
    return (async function* (): AsyncGenerator<GenerationEvent> {
      yield { type: "text", value: "Real." }
    })()
  },
  mapOpenRouterError: () => ({
    status: 500,
    message: "Generation failed. Try again.",
  }),
}))

// The loop's other collaborators run for real over silent stand-ins: this
// suite is about which provider gets consumed, and their own behavior is
// pinned in generation-calls.test.ts and generation-stream.test.ts. Only leaf
// infrastructure is mocked — mock.module is process-global, and mocking a
// module another test file imports as its SUBJECT would poison that file.
mock.module("@/lib/db/entry-writes", () => ({
  persistGeneratedEntry: async () => ({
    ok: true,
    data: { entry: { id: "entry-1" } },
  }),
}))
const silentDb = {
  insert: () => ({ values: async () => {} }),
  update() {
    const builder = {
      set: () => builder,
      where: () => Promise.resolve(),
    }
    return builder
  },
  select(): never {
    throw new Error("no select in this suite")
  },
}
mock.module("@/lib/db/client", () => ({
  getDb: async () => silentDb,
}))

const live = await import("@/lib/generation/live")

function endpoint(tag: string, throughput: number | null = 100): ModelEndpoint {
  return {
    tag,
    providerName: tag.split("/")[0],
    contextLength: 131_072,
    pricing: { prompt: "$1.00", completion: "$2.00" },
    throughput,
    uptime: 0.99,
    quantization: null,
  }
}

const ENDPOINTS = [endpoint("groq"), endpoint("deepinfra/turbo")]

describe("endpointForTag", () => {
  test("finds the pinned endpoint, variant suffix included", () => {
    expect(endpointForTag(ENDPOINTS, "deepinfra/turbo")?.tag).toBe(
      "deepinfra/turbo"
    )
  })

  test("null tag is Auto, not a lookup failure", () => {
    expect(endpointForTag(ENDPOINTS, null)).toBeNull()
  })

  test("a tag that has left the endpoint list falls back to Auto", () => {
    expect(endpointForTag(ENDPOINTS, "together")).toBeNull()
  })

  test("a bare slug does not match a suffixed endpoint", () => {
    // The reverse of the case above, and the reason the tag is stored whole:
    // "deepinfra" and "deepinfra/turbo" are different endpoints with different
    // speeds, so a partial match would silently reroute the writer.
    expect(endpointForTag(ENDPOINTS, "deepinfra")).toBeNull()
  })

  test("no endpoints means nothing is pinned", () => {
    expect(endpointForTag([], "groq")).toBeNull()
  })
})

describe("formatThroughput", () => {
  test.each([
    [41.6, "42 tps"],
    [0.4, "0 tps"],
    [999, "999 tps"],
    [1_000, "1.0k tps"],
    [1_940, "1.9k tps"],
    // Unmeasured is an em dash, never a zero: a cold endpoint is not a slow one.
    [null, "—"],
    [Number.NaN, "—"],
    [Number.POSITIVE_INFINITY, "—"],
  ] as const)("%p -> %p", (input, expected) => {
    expect(formatThroughput(input)).toBe(expected)
  })
})

describe("formatUptime", () => {
  test.each([
    [0.9987, "99%"],
    // Floored, so only a genuinely perfect week reads as 100%.
    [0.9999, "99%"],
    [1, "100%"],
    [0, "0%"],
    [null, "—"],
  ] as const)("%p -> %p", (input, expected) => {
    expect(formatUptime(input)).toBe(expected)
  })
})

describe("run loop provider resolution", () => {
  let storySeq = 0

  function launchAndFinish(storyId: string) {
    const launched = live.launchRun({
      storyId,
      requestKind: "generate",
      userEntryId: null,
      removingEntryIds: [],
      turnId: null,
      context: {
        systemPrompt: "narrate",
        memory: "",
        lore: [],
        storyText: "",
        authorsNote: "",
        seed: 0,
        approxTokens: 8,
        fit: {
          loreMatched: 0,
          loreStableMatched: 0,
          storyChars: 0,
          storyCharsKept: 0,
        },
      },
      settings: {
        modelId: "~test/model",
        thinking: "off",
        providerTag: null,
        temperature: 1,
        topP: 1,
        maxTokens: 6,
        contextWindow: 8192,
        loreBudget: 25,
        frequencyPenalty: 0,
        presencePenalty: 0,
      },
    })
    if (!launched) throw new Error("launch refused")
    const run = live.findRun(storyId, launched.runId)
    if (!run) throw new Error("run not registered")
    return new Promise<string>((resolve) => {
      let text = ""
      live.attachRun(run, (event) => {
        if (event.type === "text") text += event.value
        if (event.type === "end") resolve(text)
      })
    })
  }

  beforeEach(() => {
    currentKey = null
    streamCalls.length = 0
  })

  test("no key resolves to the offline mock — the writer still gets prose", async () => {
    // The real MockGenerationProvider runs here, real pacing and all; the
    // tiny maxTokens in launchAndFinish keeps that to a few chunks.
    const text = await launchAndFinish(`routing-${++storySeq}`)
    expect(text.length).toBeGreaterThan(0)
    expect(streamCalls).toHaveLength(0)
  })

  test("a key resolves to the real stream, and the key never leaves the loop", async () => {
    currentKey = "sk-or-test"
    const text = await launchAndFinish(`routing-${++storySeq}`)
    expect(text).toBe("Real.")
    // The key reached streamCompletion directly — no client hop, no wire.
    expect(streamCalls).toEqual([{ key: "sk-or-test" }])
  })
})
