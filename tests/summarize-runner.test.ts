// tests/summarize-runner.test.ts — The summarizer as a background job: what it
// writes, what it refuses to write, and when it gives up.
//
// Everything here is invisible from the app by design — the feature has no UI —
// so these are the only place its behaviour is stated. Three properties carry
// it:
//
// 1. A FAILED REFINE WRITES NOTHING. The stored version is the story's memory;
//    overwriting a good one with an empty or half-formed reply would lose prose
//    that is already out of the window and cannot be recovered.
// 2. RETRYING IS FREE, AND BOUNDED. The unmoved watermark means the next turn
//    tries again at no cost — right for a rate limit, wrong forever, so three
//    consecutive failures stop it and say so exactly once.
// 3. ONE AT A TIME PER STORY. A second refine is dropped rather than queued;
//    by the time the first lands the second's plan is stale anyway.
//
// The database, the provider and the ledger are all faked. The suite has no DB
// harness and a real call costs money — see the header of
// tests/generation-calls.test.ts for the same bargain.

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"

import type { Story, StoryEntry, SummarizerSettings } from "@/lib/types"

mock.module("server-only", () => ({}))

import type { SummaryIo } from "@/lib/generation/summarize"

const { runSummaryForStory, resetSummaryState } =
  await import("@/lib/generation/summarize")

// ---------------------------------------------------------------------------
// Fixtures

let seq = 0
function entry(text: string): StoryEntry {
  seq += 1
  return {
    id: `entry-${seq}`,
    source: "generated",
    text,
    actionKind: null,
    inputText: null,
    variantGroupId: `group-${seq}`,
    variantIndex: 0,
    variantCount: 1,
    variantProfilesMixed: false,
    generation: null,
    costUsd: null,
    reasoningTokens: null,
    callStatus: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  }
}

/** Long enough that prose has genuinely fallen out of an 8k window. */
const ENTRIES = Array.from({ length: 200 }, (_, index) =>
  entry(`Passage ${index}. ${"word ".repeat(80)}`.trim())
)

function makeStory(over: Partial<Story> = {}): Story {
  return {
    id: "story-1",
    title: "A Story",
    description: "",
    genre: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    wordCount: 0,
    tintHue: null,
    tintStrength: 1,
    entries: ENTRIES,
    images: [],
    imageModelId: null,
    profileId: null,
    settings: {
      modelId: "test/model",
      thinking: "off",
      providerTag: null,
      zdr: false,
      temperature: 0.9,
      topP: 0.95,
      maxTokens: 512,
      contextWindow: 8192,
      loreBudget: 25,
      frequencyPenalty: 0,
      presencePenalty: 0,
    },
    memory: "Maren owes the river a map.",
    authorsNote: "",
    summarize: true,
    summary: "",
    systemPrompt: null,
    activeLorebookEntryIds: [],
    canUndo: false,
    canRedo: false,
    undoSummary: null,
    redoSummary: null,
    ...over,
  }
}

// ---------------------------------------------------------------------------
// The fake half of the seam. No module is replaced, so nothing here reaches
// the files that are actually testing the ledger, the client or the bus.

type CompleteResult = {
  text: string
  generationId: string | null
  usage: null
}

let currentStory: Story | null = makeStory()
let apiKey: string | null = "test-key"
const BASE_SUMMARIZER: SummarizerSettings = {
  modelId: null,
  thinking: "off",
  providerTag: null,
  zdr: false,
  temperature: 0.3,
  targetWords: null,
  maxTokens: null,
}
let summarizer: SummarizerSettings = BASE_SUMMARIZER
let completeImpl: () => Promise<CompleteResult> = async () => ({
  text: "You crossed the Graywater and lost the needle.",
  generationId: "gen-1",
  usage: null,
})

const inserted: Record<string, unknown>[] = []
const settled: { id: string; status: string }[] = []
const started: Record<string, unknown>[] = []
const stopped: string[] = []
const completeCalls: Record<string, unknown>[] = []

const io: SummaryIo = {
  getStory: async () => currentStory,
  listLore: async () => [],
  resolveRecap: async () => null,
  settings: async () => ({ summarizer }),
  apiKey: () => apiKey,
  async complete(opts) {
    completeCalls.push(opts as unknown as Record<string, unknown>)
    return completeImpl()
  },
  async openCall(call) {
    started.push(call as unknown as Record<string, unknown>)
  },
  async settle(id, outcome) {
    settled.push({ id, status: outcome.status })
  },
  async storeRecap(row) {
    inserted.push(row as unknown as Record<string, unknown>)
  },
  announceStopped(storyId) {
    stopped.push(storyId)
  },
}

const run = () => runSummaryForStory("story-1", io)

beforeEach(() => {
  inserted.length = 0
  settled.length = 0
  started.length = 0
  stopped.length = 0
  completeCalls.length = 0
  currentStory = makeStory()
  apiKey = "test-key"
  summarizer = BASE_SUMMARIZER
  completeImpl = async () => ({
    text: "You crossed the Graywater and lost the needle.",
    generationId: "gen-1",
    usage: null,
  })
  resetSummaryState()
})

afterEach(() => {
  resetSummaryState()
})

// ---------------------------------------------------------------------------

describe("what it writes", () => {
  test("stores one version, through the passage it planned", async () => {
    await run()
    expect(inserted).toHaveLength(1)
    expect(inserted[0]!.storyId).toBe("story-1")
    expect(inserted[0]!.text).toBe(
      "You crossed the Graywater and lost the needle."
    )
    expect(typeof inserted[0]!.throughEntryId).toBe("string")
  })

  test("opens a ledger row as a summarize call and settles it ok", async () => {
    await run()
    expect(started).toHaveLength(1)
    expect(started[0]!.requestKind).toBe("summarize")
    // The money is the point: a call nothing can see is worse than one
    // recorded oddly.
    expect(settled).toEqual([{ id: started[0]!.id as string, status: "ok" }])
  })

  test("tells the model the story's memory, so it does not restate it", async () => {
    await run()
    expect(completeCalls[0]!.user).toContain("Maren owes the river a map.")
    expect(completeCalls[0]!.system).toContain("never restate its facts")
  })

  test("the summarizer's own retention setting reaches the provider", async () => {
    summarizer = { ...summarizer, zdr: true }
    await run()
    expect(completeCalls[0]!.zdr).toBe(true)
  })
})

describe("the settings actually reach it", () => {
  test("a story with summarizing switched off is left alone", () => {
    currentStory = makeStory({ summarize: false })
    return run().then(() => {
      expect(completeCalls).toHaveLength(0)
      expect(inserted).toHaveLength(0)
      // Nothing was billed either — the check is before the ledger row.
      expect(started).toHaveLength(0)
    })
  })

  test("the built-in summarizer is used when Settings names none", async () => {
    await run()
    expect(completeCalls[0]!.modelId).toBe("~anthropic/claude-haiku-latest")
    expect(inserted[0]!.genModelId).toBe("~anthropic/claude-haiku-latest")
  })

  test("a pinned provider and thinking level reach the request and the ledger", async () => {
    summarizer = {
      ...BASE_SUMMARIZER,
      modelId: "meta/llama-4",
      thinking: "medium",
      providerTag: "together",
    }
    await run()
    expect(completeCalls[0]!.providerTag).toBe("together")
    expect(completeCalls[0]!.thinking).toBe("medium")
    // Provenance on the ledger row, so "why was that summary slow/expensive"
    // is answerable after the setting has been changed again.
    expect(started[0]!.providerName).toBe("together")
    expect(started[0]!.thinking).toBe("medium")
  })

  test("the story's retention policy binds even when the summarizer's is off", async () => {
    currentStory = makeStory({
      settings: { ...makeStory().settings, zdr: true },
    })
    summarizer = { ...summarizer, zdr: false }
    await run()
    // It is the story's prose on the wire. A manuscript that requires zero
    // retention does not stop requiring it because a different bundle sent it.
    expect(completeCalls[0]!.zdr).toBe(true)
  })

  test("a model chosen in Settings overrides it, and is recorded on the row", async () => {
    summarizer = { ...summarizer, modelId: "openai/gpt-5-mini" }
    await run()
    expect(completeCalls[0]!.modelId).toBe("openai/gpt-5-mini")
    // Frozen on the version it wrote, so "which model said this" survives the
    // setting being changed afterwards.
    expect(inserted[0]!.genModelId).toBe("openai/gpt-5-mini")
    expect(started[0]!.modelId).toBe("openai/gpt-5-mini")
  })
})

describe("the length and sampling knobs", () => {
  test("length scales with the story's window when nothing is pinned", async () => {
    // 2048 sits at the floor; the cap is the target times the slack factor.
    currentStory = makeStory({
      settings: { ...makeStory().settings, contextWindow: 2048 },
    })
    await run()
    expect(completeCalls[0]!.user).toContain("about 150 words")
    expect(completeCalls[0]!.maxTokens).toBe(450)
  })

  test("a pinned target overrides the window, and drags the cap with it", async () => {
    summarizer = { ...BASE_SUMMARIZER, targetWords: 400 }
    await run()
    expect(completeCalls[0]!.user).toContain("about 400 words")
    expect(completeCalls[0]!.maxTokens).toBe(1200)
  })

  test("a pinned cap is used as given, target or no target", async () => {
    summarizer = { ...BASE_SUMMARIZER, targetWords: 400, maxTokens: 700 }
    await run()
    expect(completeCalls[0]!.maxTokens).toBe(700)
  })

  test("temperature comes from Settings", async () => {
    summarizer = { ...BASE_SUMMARIZER, temperature: 0.9 }
    await run()
    expect(completeCalls[0]!.temperature).toBe(0.9)
  })
})

describe("what it refuses to write", () => {
  test("nothing at all without an API key — the mock provider invents no memory", async () => {
    apiKey = null
    await run()
    expect(inserted).toHaveLength(0)
    expect(started).toHaveLength(0)
  })

  test("nothing for a story that still fits its window", async () => {
    currentStory = makeStory({ entries: ENTRIES.slice(0, 3) })
    await run()
    expect(inserted).toHaveLength(0)
    expect(started).toHaveLength(0)
  })

  test("nothing for a story that has been deleted", async () => {
    currentStory = null
    await run()
    expect(inserted).toHaveLength(0)
  })

  test("an empty reply does not overwrite a good version", async () => {
    completeImpl = async () => ({
      text: "   ",
      generationId: "gen-1",
      usage: null,
    })
    await run()
    expect(inserted).toHaveLength(0)
    expect(settled[0]!.status).toBe("error")
  })

  test("a provider failure writes nothing and still settles the row", async () => {
    completeImpl = async () => {
      throw new Error("429")
    }
    await run()
    expect(inserted).toHaveLength(0)
    expect(settled).toHaveLength(1)
    expect(settled[0]!.status).toBe("error")
  })
})

describe("giving up", () => {
  test("retries quietly, then stops after three in a row and says so once", async () => {
    completeImpl = async () => {
      throw new Error("model retired")
    }
    await run()
    await run()
    // Two failures are still assumed transient — nothing has interrupted the
    // writer, and the next turn would try again for free.
    expect(stopped).toHaveLength(0)

    await run()
    expect(stopped).toEqual(["story-1"])

    // ...and having given up, it stops spending money.
    const callsBefore = completeCalls.length
    await run()
    await run()
    expect(completeCalls).toHaveLength(callsBefore)
    expect(stopped).toHaveLength(1)
  })

  test("a success clears the count, so blips never accumulate into a trip", async () => {
    let failNext = true
    completeImpl = async () => {
      if (failNext) throw new Error("blip")
      return { text: "You fell.", generationId: null, usage: null }
    }
    await run()
    await run()
    failNext = false
    await run()
    failNext = true
    await run()
    await run()
    expect(stopped).toHaveLength(0)
  })
})

describe("one at a time", () => {
  test("a second refine for the same story is dropped, not queued", async () => {
    let release = (): void => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    completeImpl = async () => {
      await held
      return { text: "You fell.", generationId: null, usage: null }
    }
    const first = run()
    // Wait until the first is genuinely at the provider — several awaits sit
    // between the call and here, and a fixed number of ticks would be a guess.
    while (completeCalls.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 1))
    }
    await run()
    expect(completeCalls).toHaveLength(1)
    release()
    await first
    expect(inserted).toHaveLength(1)
  })
})
