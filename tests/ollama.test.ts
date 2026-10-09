// tests/ollama.test.ts — The local Ollama backend: what the catalog offers,
// how a chat stream is read, and how the decision route differs from
// OpenRouter's. Every call is a stubbed fetch, so this runs with no host.

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"

import type { DecisionQuestion } from "@/lib/generation/types"

mock.module("server-only", () => ({}))

const ollama = await import("@/lib/generation/ollama")
const { streamOllamaCompletion, completeOllamaOnce, LocalModelError } =
  await import("@/lib/generation/ollama-chat")
const { decideOnce, DecisionError, flattenChoiceGuidance } =
  await import("@/lib/generation/decide")

const BASE = "http://metis.olympus.lan:11434"
const realFetch = globalThis.fetch
const savedEnv = { ...process.env }

interface Call {
  url: string
  init: RequestInit | undefined
}
let calls: Call[] = []

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

/** NDJSON split at arbitrary byte boundaries, as a network delivers it. */
function ndjson(lines: unknown[], cut = 7) {
  const text = lines.map((line) => JSON.stringify(line)).join("\n") + "\n"
  const bytes = new TextEncoder().encode(text)
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < bytes.length; i += cut) {
          controller.enqueue(bytes.slice(i, i + cut))
        }
        controller.close()
      },
    }),
    { status: 200 }
  )
}

const SHOW: Record<string, unknown> = {
  "qwen3.8:27b-mlx": {
    capabilities: ["completion", "vision", "tools", "thinking"],
    model_info: { "qwen3_5.context_length": 262144 },
  },
  "gemma4:12b-mlx": {
    capabilities: ["completion"],
    model_info: { "gemma4.context_length": 32768 },
  },
  "qwen3-embedding:4b": { capabilities: ["embedding"] },
  tev1: { capabilities: ["decision"], model_info: {} },
}

/** A host with three chat-capable models, an embedder and a decision model. */
function stubHost(chat?: (body: Record<string, unknown>) => Response) {
  globalThis.fetch = (async (input: string, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    const path = url.slice(BASE.length)
    if (path === "/api/version") return json({ version: "0.40.2" })
    if (path === "/api/tags") {
      return json({
        models: [
          {
            name: "qwen3.8:27b-mlx",
            digest: "a",
            details: { quantization_level: "nvfp4" },
          },
          { name: "gemma4:12b-mlx", digest: "b", details: {} },
          { name: "qwen3-embedding:4b", digest: "c", details: {} },
          { name: "tev1", digest: "d", details: {} },
        ],
      })
    }
    if (path === "/api/ps") {
      return json({
        models: [
          { name: "qwen3.8:27b-mlx", expires_at: "2026-10-09T12:44:07Z" },
          { name: "qwen3-embedding:4b", expires_at: "2026-10-09T12:44:07Z" },
        ],
      })
    }
    if (path === "/api/show") {
      const { model } = JSON.parse(String(init?.body)) as { model: string }
      return json(SHOW[model])
    }
    if (path === "/api/chat" && chat) {
      return chat(JSON.parse(String(init?.body)) as Record<string, unknown>)
    }
    return json({ error: "unexpected" }, 500)
  }) as unknown as typeof fetch
}

beforeEach(() => {
  calls = []
  process.env.OLLAMA_BASE_URL = `${BASE}/`
  delete process.env.OLLAMA_NUM_CTX
  ollama.invalidateOllamaCatalog()
})

afterEach(() => {
  globalThis.fetch = realFetch
  process.env = { ...savedEnv }
})

describe("the local catalog", () => {
  test("offers chat models as catalog entries and leaves the embedder out", async () => {
    stubHost()
    const models = await ollama.listOllamaChatModels()
    expect(models.map((m) => m.id)).toEqual([
      "ollama:gemma4:12b-mlx",
      "ollama:qwen3.8:27b-mlx",
    ])
    const qwen = models.find((m) => m.id === "ollama:qwen3.8:27b-mlx")!
    expect(qwen).toMatchObject({
      name: "Qwen 3.8 27B",
      provider: "Ollama · metis",
      pricing: { prompt: "$0.00", completion: "$0.00" },
      zdr: true,
      reasoning: { efforts: ["medium"], mandatory: false },
      local: { host: "metis", loaded: true, quantization: "nvfp4" },
    })
  })

  test("reports the window that will be sent, capped by what the model was trained for", async () => {
    stubHost()
    process.env.OLLAMA_NUM_CTX = "65536"
    const models = await ollama.listOllamaChatModels()
    const byId = Object.fromEntries(models.map((m) => [m.id, m.contextLength]))
    expect(byId["ollama:qwen3.8:27b-mlx"]).toBe(65536)
    expect(byId["ollama:gemma4:12b-mlx"]).toBe(32768)
  })

  test("lists decision models separately", async () => {
    stubHost()
    const decision = await ollama.listOllamaDecisionModels()
    expect(decision.map((m) => m.id)).toEqual(["ollama:tev1"])
    expect(decision[0]).toMatchObject({ promptPrice: "$0.00", zdr: true })
  })

  test("is empty, not an error, when the host is down or unconfigured", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("fetch failed")
    }) as unknown as typeof fetch
    expect(await ollama.listOllamaChatModels()).toEqual([])
    const status = await ollama.getLocalModelsStatus()
    expect(status).toMatchObject({ host: "metis", reachable: false })

    delete process.env.OLLAMA_BASE_URL
    expect(await ollama.getLocalModelsStatus()).toBeNull()
  })

  test("names models readably, and falls back to the raw name on a clash", () => {
    expect(ollama.displayName("qwen3.8:27b-mlx")).toBe("Qwen 3.8 27B")
    expect(ollama.displayName("muse-glimmer:30b-q4_K_M")).toBe(
      "Muse Glimmer 30B"
    )
    expect(ollama.displayName("hf.co/someone/gemma4:latest")).toBe("Gemma 4")
  })
})

test("the status lists only loaded models a picker offers", async () => {
  stubHost()
  const status = await ollama.getLocalModelsStatus()
  expect(status?.loaded.map((m) => m.modelId)).toEqual([
    "ollama:qwen3.8:27b-mlx",
  ])
})

describe("a local chat stream", () => {
  test("yields reasoning lengths, prose and free usage, across split chunks", async () => {
    let sent: Record<string, unknown> = {}
    stubHost((body) => {
      sent = body
      return ndjson([
        { message: { thinking: "Let me think" } },
        { message: { content: "The tide " } },
        { message: { content: "turned." } },
        { done: true, prompt_eval_count: 900, eval_count: 40 },
      ])
    })
    const events = []
    for await (const event of streamOllamaCompletion({
      modelId: "ollama:qwen3.8:27b-mlx",
      system: "Narrate.",
      user: "Go on.",
      thinking: "high",
      temperature: 0.8,
      seed: 3,
      signal: new AbortController().signal,
    })) {
      events.push(event)
    }
    expect(events).toEqual([
      { type: "reasoning", chars: 12 },
      { type: "text", value: "The tide " },
      { type: "text", value: "turned." },
      {
        type: "usage",
        usage: expect.objectContaining({
          promptTokens: 900,
          completionTokens: 40,
          costUsd: 0,
        }),
      },
    ])
    // A single-level thinking model takes a plain on/off, and the window is
    // the fixed one so the host never reloads for it.
    expect(sent).toMatchObject({
      model: "qwen3.8:27b-mlx",
      stream: true,
      think: true,
      options: { num_ctx: 65536, temperature: 0.8, seed: 3 },
    })
  })

  test("never sends `think` to a model that cannot think", async () => {
    let sent: Record<string, unknown> = {}
    stubHost((body) => {
      sent = body
      return json({ message: { content: "ok" }, done: true })
    })
    await completeOllamaOnce({
      modelId: "ollama:gemma4:12b-mlx",
      system: "s",
      user: "u",
      thinking: "medium",
      temperature: 0.2,
      maxTokens: 64,
    })
    expect("think" in sent).toBe(false)
    expect(sent).toMatchObject({ options: { num_predict: 64 } })
  })

  test("a missing model and a dead host fail with sentences a writer can act on", async () => {
    stubHost(() => json({ error: "model 'gone' not found" }, 404))
    const gone = completeOllamaOnce({
      modelId: "ollama:gone",
      system: "s",
      user: "u",
      thinking: "off",
      temperature: 0,
    })
    await expect(gone).rejects.toBeInstanceOf(LocalModelError)
    await expect(gone).rejects.toThrow("gone isn't installed on metis")

    globalThis.fetch = (async () => {
      throw new TypeError("fetch failed")
    }) as unknown as typeof fetch
    await expect(
      completeOllamaOnce({
        modelId: "ollama:gone",
        system: "s",
        user: "u",
        thinking: "off",
        temperature: 0,
      })
    ).rejects.toThrow("metis isn't answering")
  })
})

describe("a local decision", () => {
  const QUESTIONS: Record<string, DecisionQuestion> = {
    fits: { type: "noul", instructions: "Does it fit?" },
  }

  test("goes to the host's System One route with no key and no retention block, and is free", async () => {
    let url = ""
    let init: RequestInit | undefined
    globalThis.fetch = (async (input: string, i?: RequestInit) => {
      url = String(input)
      init = i
      return json({
        answers: { fits: { type: "noul", noul: 0.8 } },
        usage: { input_tokens: 120, output_tokens: 0 },
      })
    }) as unknown as typeof fetch
    const result = await decideOnce({
      state: { tail: "quiet" },
      questions: QUESTIONS,
      modelId: "ollama:tev1",
      zdr: true,
      key: "",
    })
    expect(url).toBe(`${BASE}/v1/systemone`)
    const headers = init?.headers as Record<string, string>
    expect(headers.Authorization).toBeUndefined()
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    expect(body.model).toBe("tev1")
    expect(body.provider).toBeUndefined()
    expect(result.usage?.costUsd).toBe(0)
  })

  test("labelled choice guidance is folded into text, which is all Ollama takes", async () => {
    let body: { questions: Record<string, DecisionQuestion> } | null = null
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      body = JSON.parse(String(init?.body))
      return json({ answers: { tint: { type: "choice", choice: "abyss" } } })
    }) as unknown as typeof fetch
    await decideOnce({
      state: {},
      questions: {
        tint: {
          type: "choice",
          instructions: "Which fits?",
          criteria: {
            abyss: {
              what: "deep water",
              not_for: "night",
              examples: ["a", "b"],
            },
            sun: "noon",
          },
        },
      },
      modelId: "ollama:tev1",
      zdr: false,
      key: "",
    })
    expect(body!.questions.tint).toEqual({
      type: "choice",
      instructions: "Which fits?",
      criteria: {
        abyss: "what: deep water\nnot for: night\nexamples: a / b",
        sun: "noon",
      },
    })
    // The flattening is the local route's alone.
    expect(
      flattenChoiceGuidance({ q: { type: "noul", instructions: "?" } })
    ).toEqual({ q: { type: "noul", instructions: "?" } })
  })

  test("a refused request carries Ollama's own reason", async () => {
    globalThis.fetch = (async () =>
      json(
        { error: "prompt 1 has 2296 tokens; expected 1–2048" },
        400
      )) as unknown as typeof fetch
    await expect(
      decideOnce({
        state: {},
        questions: QUESTIONS,
        modelId: "ollama:tev1",
        zdr: false,
        key: "",
      })
    ).rejects.toThrow("prompt 1 has 2296 tokens")
  })

  test("a model that was never pulled says so", async () => {
    globalThis.fetch = (async () =>
      json({ error: "not found" }, 404)) as unknown as typeof fetch
    const call = decideOnce({
      state: {},
      questions: QUESTIONS,
      modelId: "ollama:nimble",
      zdr: false,
      key: "",
    })
    await expect(call).rejects.toBeInstanceOf(DecisionError)
    await expect(call).rejects.toThrow("nimble isn't installed on metis")
  })

  test("a state over Ollama's 64 KiB cap is refused before it is sent", async () => {
    let sent = false
    globalThis.fetch = (async () => {
      sent = true
      return json({})
    }) as unknown as typeof fetch
    await expect(
      decideOnce({
        state: { memory: "x".repeat(70 * 1024) },
        questions: QUESTIONS,
        modelId: "ollama:tev1",
        zdr: false,
        key: "",
      })
    ).rejects.toThrow("too long for a local decision model")
    expect(sent).toBe(false)
  })
})
