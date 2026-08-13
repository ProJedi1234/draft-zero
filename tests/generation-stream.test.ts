// tests/generation-stream.test.ts — The specification for the NDJSON generation
// stream: the client decoder's framing, and the mock provider's event sequence.
//
// The decoder is the part worth pinning down. A network read boundary has
// nothing to do with a record boundary, so every one of these cases is
// something a real connection will do sooner or later — and the failure mode is
// silent: a dropped frame is a missing sentence in someone's manuscript, not an
// exception.

import { afterEach, describe, expect, test } from "bun:test"

import { MockGenerationProvider } from "@/lib/generation/mock-provider"
import { OpenRouterProvider } from "@/lib/generation/openrouter-provider"
import type { ComposedContext, GenerationEvent } from "@/lib/generation/types"
import type { GenerationSettings, ThinkingLevel } from "@/lib/types"

const context: ComposedContext = {
  systemPrompt: "narrate",
  memory: "",
  lore: [],
  storyText: "",
  authorsNote: "",
  seed: 0,
  approxTokens: 128,
}

function settings(overrides: Partial<GenerationSettings> = {}) {
  return {
    modelId: "~test/model",
    thinking: "off" as ThinkingLevel,
    providerTag: null,
    temperature: 1,
    topP: 1,
    maxTokens: 200,
    frequencyPenalty: 0,
    presencePenalty: 0,
    ...overrides,
  } as GenerationSettings
}

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

/** Stubs /api/generate with a body delivered as exactly these raw reads. */
function respondWith(reads: string[]) {
  const encoder = new TextEncoder()
  globalThis.fetch = (async () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (const read of reads) controller.enqueue(encoder.encode(read))
          controller.close()
        },
      }),
      { headers: { "content-type": "application/x-ndjson" } }
    )) as unknown as typeof fetch
}

async function collect(): Promise<GenerationEvent[]> {
  const events: GenerationEvent[] = []
  for await (const event of new OpenRouterProvider().generate({
    context,
    settings: settings(),
  })) {
    events.push(event)
  }
  return events
}

describe("NDJSON decoding", () => {
  test("one event per line, one line per read", async () => {
    respondWith([
      '{"type":"text","value":"The rain "}\n',
      '{"type":"text","value":"had stopped."}\n',
    ])
    expect(await collect()).toEqual([
      { type: "text", value: "The rain " },
      { type: "text", value: "had stopped." },
    ])
  })

  test("several events arriving in a single read are all yielded", async () => {
    respondWith([
      '{"type":"reasoning","chars":40}\n{"type":"reasoning","chars":47}\n{"type":"text","value":"Snow."}\n',
    ])
    expect(await collect()).toEqual([
      { type: "reasoning", chars: 40 },
      { type: "reasoning", chars: 47 },
      { type: "text", value: "Snow." },
    ])
  })

  test("an event split across reads is held until its newline arrives", async () => {
    // The exact failure the buffer exists for: parsing the first read eagerly
    // throws, and the sentence is gone.
    respondWith([
      '{"type":"te',
      'xt","value":"Snow began',
      ' without ceremony."}\n',
    ])
    expect(await collect()).toEqual([
      { type: "text", value: "Snow began without ceremony." },
    ])
  })

  test("a read ending mid-line still yields the completed lines before it", async () => {
    respondWith([
      '{"type":"text","value":"a"}\n{"type":"te',
      'xt","value":"b"}\n',
    ])
    expect(await collect()).toEqual([
      { type: "text", value: "a" },
      { type: "text", value: "b" },
    ])
  })

  test("a final line with no trailing newline is not dropped", async () => {
    // Usage is always last, so this is the case that decides whether exact token
    // counts ever arrive at all.
    respondWith([
      '{"type":"text","value":"a"}\n',
      '{"type":"usage","usage":{"promptTokens":10,"completionTokens":4,"reasoningTokens":2}}',
    ])
    expect(await collect()).toEqual([
      { type: "text", value: "a" },
      {
        type: "usage",
        usage: { promptTokens: 10, completionTokens: 4, reasoningTokens: 2 },
      },
    ])
  })

  test("a multi-byte character split across reads survives", async () => {
    // TextDecoder({stream:true}) holds the partial code point; without it this
    // arrives as two replacement characters mid-word.
    const encoder = new TextEncoder()
    const bytes = encoder.encode('{"type":"text","value":"café"}\n')
    const split = bytes.indexOf(0xc3) + 1 // between the two bytes of "é"
    globalThis.fetch = (async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes.slice(0, split))
            controller.enqueue(bytes.slice(split))
            controller.close()
          },
        })
      )) as unknown as typeof fetch
    expect(await collect()).toEqual([{ type: "text", value: "café" }])
  })

  test("a malformed line is skipped and the stream continues", async () => {
    // Losing one frame beats throwing away the passage that came before it —
    // the same "keep the partial text" bargain Stop already makes.
    respondWith([
      '{"type":"text","value":"a"}\nnot json\n{"type":"text","value":"b"}\n',
    ])
    expect(await collect()).toEqual([
      { type: "text", value: "a" },
      { type: "text", value: "b" },
    ])
  })

  test("blank lines are framing, not errors", async () => {
    respondWith(['\n{"type":"text","value":"a"}\n\n'])
    expect(await collect()).toEqual([{ type: "text", value: "a" }])
  })

  test("a non-ok response throws the server's message", async () => {
    globalThis.fetch = (async () =>
      Response.json(
        { error: "OpenRouter credits exhausted. Top up your account." },
        { status: 402 }
      )) as unknown as typeof fetch
    expect(collect()).rejects.toThrow("credits exhausted")
  })
})

describe("MockGenerationProvider events", () => {
  const fast = { initialDelayMs: 0, chunkDelayMs: 0, reasoningDelayMs: 0 }

  async function run(thinking: ThinkingLevel) {
    const events: GenerationEvent[] = []
    for await (const event of new MockGenerationProvider(fast).generate({
      context,
      settings: settings({ thinking }),
    })) {
      events.push(event)
    }
    return events
  }

  test("thinking off emits no reasoning events", async () => {
    const events = await run("off")
    expect(events.some((e) => e.type === "reasoning")).toBe(false)
  })

  test("a thinking level emits reasoning before any prose", async () => {
    const events = await run("medium")
    const firstText = events.findIndex((e) => e.type === "text")
    const reasoning = events.filter((e) => e.type === "reasoning")
    expect(reasoning).toHaveLength(14)
    expect(
      events.slice(0, firstText).every((e) => e.type === "reasoning")
    ).toBe(true)
  })

  test("higher levels think longer", async () => {
    const low = (await run("low")).filter((e) => e.type === "reasoning").length
    const max = (await run("max")).filter((e) => e.type === "reasoning").length
    expect(max).toBeGreaterThan(low)
  })

  test("usage lands last, and counts the reasoning it reported", async () => {
    const events = await run("low")
    const last = events[events.length - 1]
    expect(last.type).toBe("usage")
    if (last.type !== "usage") throw new Error("unreachable")

    const chars = events.reduce(
      (sum, e) => (e.type === "reasoning" ? sum + e.chars : sum),
      0
    )
    expect(last.usage.reasoningTokens).toBe(Math.ceil(chars / 4))
    expect(last.usage.promptTokens).toBe(context.approxTokens)
    expect(last.usage.completionTokens).toBeGreaterThan(0)
  })

  test("the same seed produces the same run", async () => {
    expect(await run("medium")).toEqual(await run("medium"))
  })
})
