// tests/atmosphere-runner.test.ts — The tint picker as a background job: when
// it asks, what it does with the answer, and when it stops asking.
//
// Its sibling (tests/summarize-runner.test.ts) guards a thing that must not be
// lost. This one guards a thing that must not be annoying, which turns out to
// need more tests, not fewer. Four properties carry it:
//
// 1. IT ASKS RARELY. Auto off means never; a story that has barely moved since
//    the last check means not yet. The gate is the entire cost story, and it is
//    also why a writer polishing one paragraph does not watch the room strobe.
// 2. "KEEP" IS A REAL ANSWER. It settles ok, it clears the failure count, and
//    it advances the watermark exactly as a repaint does — otherwise the gate
//    reopens every turn until the model finally says something else, which is
//    the runaway the gate exists to prevent.
// 3. A BAD ANSWER WRITES NOTHING. Anything that is not one word from the list
//    is a failed check. What survives parsing is interpolated into a stylesheet.
// 4. GIVING UP IS SILENT. Three strikes stop the spending, and nothing toasts:
//    an unprompted message about a colour, sent mid-sentence, about a job the
//    writer may not know exists, is worse than a room that stays the colour it
//    already was.
//
// The database, the provider and the ledger are all faked — see the header of
// tests/summarize-runner.test.ts for the same bargain.

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"

import type { GenerationUsage } from "@/lib/generation/types"
import type { AtmospherePhase } from "@/lib/sync/types"
import type { AtmosphereSettings, Story, StoryEntry } from "@/lib/types"

mock.module("server-only", () => ({}))

import type { AtmosphereIo } from "@/lib/generation/atmosphere"

const { runAtmosphereForStory, resetAtmosphereState, clearAtmosphereBreaker } =
  await import("@/lib/generation/atmosphere")

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

const ENTRIES = [
  entry("The lamps went out one street at a time."),
  entry("You followed the water down until the water stopped."),
]

function makeStory(over: Partial<Story> = {}): Story {
  return {
    id: "story-1",
    title: "A Story",
    description: "",
    genre: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    wordCount: 1000,
    tintHue: null,
    tintStrength: 1,
    tintAuto: true,
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

/** The story as it looks already wearing Abyss (hue 255 in STORY_TINTS). */
function tinted(over: Partial<Story> = {}): Story {
  return makeStory({ tintHue: 255, tintStrength: 0.85, ...over })
}

// ---------------------------------------------------------------------------
// The fake half of the seam.

type CompleteResult = {
  text: string
  generationId: string | null
  /** Only the empty-reply diagnosis reads this; every other case sends null. */
  usage: GenerationUsage | null
}

let currentStory: Story | null = makeStory()
let apiKey: string | null = "test-key"
const BASE_ATMOSPHERE: AtmosphereSettings = {
  modelId: null,
  thinking: "off",
  providerTag: null,
  zdr: false,
  temperature: 0.2,
  maxTokens: 2048,
}
let atmosphere: AtmosphereSettings = BASE_ATMOSPHERE
let completeImpl: () => Promise<CompleteResult> = async () => ({
  text: "abyss",
  generationId: "gen-1",
  usage: null,
})

// What the predicated UPDATE reports: true = the row was still auto and the
// tint landed; false = a swatch press pinned the story while the check flew.
let writeResult: () => boolean = () => true

const written: { storyId: string; hue: number; strength: number }[] = []
const announced: string[] = []
const phases: {
  storyId: string
  phase: AtmospherePhase
  message: string | null
}[] = []
const settled: { id: string; status: string }[] = []
const started: Record<string, unknown>[] = []
const completeCalls: Record<string, unknown>[] = []

const io: AtmosphereIo = {
  getStory: async () => currentStory,
  settings: async () => ({ atmosphere }),
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
  async writeTint(storyId, tint) {
    written.push({ storyId, ...tint })
    return writeResult()
  },
  announceChanged(storyId) {
    announced.push(storyId)
  },
  announcePhase(storyId, phase, message) {
    phases.push({ storyId, phase, message })
  },
}

const run = () => runAtmosphereForStory("story-1", io)

beforeEach(() => {
  written.length = 0
  announced.length = 0
  phases.length = 0
  settled.length = 0
  started.length = 0
  completeCalls.length = 0
  currentStory = makeStory()
  apiKey = "test-key"
  atmosphere = BASE_ATMOSPHERE
  completeImpl = async () => ({
    text: "abyss",
    generationId: "gen-1",
    usage: null,
  })
  writeResult = () => true
  resetAtmosphereState()
})

afterEach(() => {
  resetAtmosphereState()
})

// ---------------------------------------------------------------------------

describe("when it asks at all", () => {
  test("a story the writer has pinned by hand is never asked about", async () => {
    currentStory = tinted({ tintAuto: false })
    await run()
    expect(completeCalls).toHaveLength(0)
    // Nothing was billed either — the gate is before the ledger row.
    expect(started).toHaveLength(0)
  })

  test("an untinted story is asked immediately, however short", async () => {
    currentStory = makeStory({ wordCount: 12 })
    await run()
    expect(completeCalls).toHaveLength(1)
  })

  test("a tinted story that has barely moved is left alone", async () => {
    currentStory = tinted({ wordCount: 1000 })
    await run()
    expect(completeCalls).toHaveLength(1)

    // Two more passages' worth of words is not enough to reopen the question.
    currentStory = tinted({ wordCount: 1080 })
    await run()
    expect(completeCalls).toHaveLength(1)
  })

  test("a tinted story that has genuinely moved is asked again", async () => {
    currentStory = tinted({ wordCount: 1000 })
    await run()
    currentStory = tinted({ wordCount: 1200 })
    await run()
    expect(completeCalls).toHaveLength(2)
  })

  test("a story that has been deleted is not asked about", async () => {
    currentStory = null
    await run()
    expect(completeCalls).toHaveLength(0)
    expect(written).toHaveLength(0)
  })

  test("nothing at all without an API key — the mock invents no taste", async () => {
    apiKey = null
    await run()
    expect(completeCalls).toHaveLength(0)
    expect(started).toHaveLength(0)
    expect(written).toHaveLength(0)
  })
})

describe("what it does with the answer", () => {
  test("a tint id is resolved to its calibrated hue and strength, and announced", async () => {
    completeImpl = async () => ({
      text: "lagoon",
      generationId: "gen-1",
      usage: null,
    })
    await run()
    expect(written).toEqual([{ storyId: "story-1", hue: 200, strength: 0.85 }])
    // The generic "this story moved" is what makes open devices re-tint.
    expect(announced).toEqual(["story-1"])
    expect(settled).toEqual([{ id: started[0]!.id as string, status: "ok" }])
  })

  test("the model may answer with punctuation and still be answering", async () => {
    completeImpl = async () => ({
      text: '  "Ember."\n',
      generationId: null,
      usage: null,
    })
    await run()
    expect(written[0]!.hue).toBe(25)
  })

  test("keep writes nothing, tells nobody, and still settles ok", async () => {
    completeImpl = async () => ({
      text: "keep",
      generationId: "gen-1",
      usage: null,
    })
    await run()
    expect(written).toHaveLength(0)
    expect(announced).toHaveLength(0)
    expect(settled[0]!.status).toBe("ok")
  })

  test("naming the colour the story already wears is treated as keep", async () => {
    currentStory = tinted()
    completeImpl = async () => ({
      text: "abyss",
      generationId: null,
      usage: null,
    })
    await run()
    // A write here would push a change event at every open device to tell them
    // nothing changed.
    expect(written).toHaveLength(0)
    expect(announced).toHaveLength(0)
  })

  test("keep advances the watermark, exactly as a repaint does", async () => {
    completeImpl = async () => ({
      text: "keep",
      generationId: null,
      usage: null,
    })
    currentStory = tinted({ wordCount: 1000 })
    await run()
    currentStory = tinted({ wordCount: 1050 })
    await run()
    // Without the advance, "keep" would reopen the question every single turn.
    expect(completeCalls).toHaveLength(1)
  })

  test("an untinted keep gates the next look — no per-turn runaway", async () => {
    completeImpl = async () => ({
      text: "keep",
      generationId: null,
      usage: null,
    })
    // Untinted is eager for the FIRST look only. "No tint yet" is this model's
    // standing answer, and a bypass keyed on the hue would re-ask at full price
    // after every turn until it changed its mind.
    currentStory = makeStory({ wordCount: 1000 })
    await run()
    currentStory = makeStory({ wordCount: 1050 })
    await run()
    expect(completeCalls).toHaveLength(1)
    currentStory = makeStory({ wordCount: 1200 })
    await run()
    expect(completeCalls).toHaveLength(2)
  })

  test("a swatch pressed while the check flew wins, and nothing is announced", async () => {
    // The predicated UPDATE reports that the row was no longer auto.
    writeResult = () => false
    completeImpl = async () => ({
      text: "lagoon",
      generationId: "gen-1",
      usage: null,
    })
    await run()
    // The call still happened and is still billed and settled ok — the model
    // answered; the writer just outranked it. But no device is told to fade
    // off the colour that was pressed.
    expect(announced).toHaveLength(0)
    expect(settled[0]!.status).toBe("ok")
  })

  test("a failed tint write settles the row error, once, with the breaker charged", async () => {
    io.writeTint = async () => {
      throw new Error("connection terminated")
    }
    try {
      await run()
    } finally {
      io.writeTint = async (storyId, tint) => {
        written.push({ storyId, ...tint })
        return writeResult()
      }
    }
    // One settle, not an "ok" followed by an "error" that wipes the usage the
    // ok recorded — the write runs before the settle for exactly this case.
    expect(settled).toEqual([{ id: started[0]!.id as string, status: "error" }])
    expect(announced).toHaveLength(0)
  })

  test("a repaint advances the watermark too", async () => {
    currentStory = tinted({ wordCount: 1000 })
    completeImpl = async () => ({
      text: "rose",
      generationId: null,
      usage: null,
    })
    await run()
    currentStory = tinted({ tintHue: 350, wordCount: 1050 })
    await run()
    expect(completeCalls).toHaveLength(1)
  })
})

describe("what it refuses to write", () => {
  test("a model that explains itself has failed the check", async () => {
    completeImpl = async () => ({
      text: "I think abyss suits this scene best.",
      generationId: "gen-1",
      usage: null,
    })
    await run()
    expect(written).toHaveLength(0)
    expect(settled[0]!.status).toBe("error")
  })

  test("a word that is not a tint is not a tint", async () => {
    completeImpl = async () => ({
      text: "teal",
      generationId: null,
      usage: null,
    })
    await run()
    expect(written).toHaveLength(0)
    expect(settled[0]!.status).toBe("error")
  })

  test("an empty reply leaves the story wearing what it was wearing", async () => {
    completeImpl = async () => ({
      text: "   ",
      generationId: null,
      usage: null,
    })
    await run()
    expect(written).toHaveLength(0)
    expect(settled[0]!.status).toBe("error")
  })

  test("a provider failure writes nothing and still settles the row", async () => {
    completeImpl = async () => {
      throw new Error("429")
    }
    await run()
    expect(written).toHaveLength(0)
    expect(settled).toEqual([{ id: started[0]!.id as string, status: "error" }])
  })

  test("a failed check does not advance the watermark — the next turn retries", async () => {
    completeImpl = async () => {
      throw new Error("429")
    }
    currentStory = tinted({ wordCount: 1000 })
    await run()
    completeImpl = async () => ({
      text: "rose",
      generationId: null,
      usage: null,
    })
    currentStory = tinted({ wordCount: 1010 })
    await run()
    expect(completeCalls).toHaveLength(2)
    expect(written).toHaveLength(1)
  })
})

describe("what reaches the model", () => {
  test("the tint it is choosing between, the story's memory, and its recent prose", async () => {
    currentStory = tinted()
    await run()
    const user = completeCalls[0]!.user as string
    expect(user).toContain("Maren owes the river a map.")
    expect(user).toContain("abyss")
    expect(user).toContain("The lamps went out one street at a time.")
    expect(completeCalls[0]!.system).toContain("keep")
  })

  test("an untinted story says so rather than naming a colour", async () => {
    await run()
    expect(completeCalls[0]!.user).toContain("never been tinted")
  })

  test("the built-in picker is used when Settings names none", async () => {
    await run()
    expect(completeCalls[0]!.modelId).toBe("~anthropic/claude-haiku-latest")
    expect(started[0]!.requestKind).toBe("atmosphere")
  })

  test("a pinned model, provider and thinking level reach the request and the ledger", async () => {
    atmosphere = {
      ...BASE_ATMOSPHERE,
      modelId: "openai/gpt-5-mini",
      thinking: "medium",
      providerTag: "together",
      temperature: 0.7,
    }
    await run()
    expect(completeCalls[0]!.modelId).toBe("openai/gpt-5-mini")
    expect(completeCalls[0]!.providerTag).toBe("together")
    expect(completeCalls[0]!.thinking).toBe("medium")
    expect(completeCalls[0]!.temperature).toBe(0.7)
    expect(started[0]!.modelId).toBe("openai/gpt-5-mini")
    expect(started[0]!.providerName).toBe("together")
    expect(started[0]!.thinking).toBe("medium")
  })

  test("the cap is the writer's number, not one derived from the thinking level", async () => {
    // Sizing the cap from the thinking LEVEL was the version of this that
    // looked right and was wrong: a model can reason with thinking off (gpt-
    // oss-20b does), spend the cap thinking, and answer nothing.
    atmosphere = { ...BASE_ATMOSPHERE, maxTokens: 4096 }
    await run()
    expect(completeCalls[0]!.maxTokens).toBe(4096)
    expect(completeCalls[0]!.thinking).toBe("off")
  })

  test("the picker's own retention setting reaches the provider", async () => {
    atmosphere = { ...BASE_ATMOSPHERE, zdr: true }
    await run()
    expect(completeCalls[0]!.zdr).toBe(true)
  })

  test("the story's retention policy binds even when the picker's is off", async () => {
    currentStory = makeStory({
      settings: { ...makeStory().settings, zdr: true },
    })
    atmosphere = { ...BASE_ATMOSPHERE, zdr: false }
    await run()
    // It is the story's prose on the wire, whichever bundle sent it.
    expect(completeCalls[0]!.zdr).toBe(true)
  })
})

describe("giving up", () => {
  test("retries quietly, then stops after three in a row — and says nothing", async () => {
    completeImpl = async () => {
      throw new Error("model retired")
    }
    await run()
    await run()
    await run()
    expect(completeCalls).toHaveLength(3)

    // Having given up, it stops spending money.
    await run()
    await run()
    expect(completeCalls).toHaveLength(3)
    // ...and never toasted. A colour is not worth interrupting a sentence for.
    expect(announced).toHaveLength(0)
  })

  test("a success clears the count, so blips never accumulate into a trip", async () => {
    // Failures never advance the watermark, so the gate stays open through the
    // blips; only the "keep" moves it, and the story is moved past it by hand.
    let failNext = true
    completeImpl = async () => {
      if (failNext) throw new Error("blip")
      return { text: "keep", generationId: null, usage: null }
    }
    await run()
    await run()
    failNext = false
    await run()
    currentStory = makeStory({ wordCount: 1200 })
    failNext = true
    await run()
    await run()
    await run()
    expect(completeCalls).toHaveLength(6)
  })
})

describe("saying what it is doing", () => {
  test("a check that repaints announces checking then painted", async () => {
    completeImpl = async () => ({
      text: "lagoon",
      generationId: null,
      usage: null,
    })
    await run()
    expect(phases.map((p) => p.phase)).toEqual(["checking", "painted"])
    expect(phases.every((p) => p.message === null)).toBe(true)
  })

  test("a kept scene is a success with its own phase", async () => {
    completeImpl = async () => ({
      text: "keep",
      generationId: null,
      usage: null,
    })
    await run()
    // Distinct from "painted": nothing moved, so the spinner stopping is the
    // whole of the feedback there is to give.
    expect(phases.map((p) => p.phase)).toEqual(["checking", "kept"])
  })

  test("the gate declining announces nothing at all", async () => {
    currentStory = tinted({ tintAuto: false })
    await run()
    // A spinner for a check that never ran would blink after every turn and
    // mean nothing.
    expect(phases).toHaveLength(0)
  })

  test("a model that thinks past its cap is told so by name", async () => {
    atmosphere = { ...BASE_ATMOSPHERE, modelId: "openai/gpt-oss-20b" }
    completeImpl = async () => ({
      text: "",
      generationId: "gen-1",
      // The signature of the real failure: the whole budget went to reasoning
      // and no content came back.
      usage: {
        promptTokens: 581,
        completionTokens: 200,
        reasoningTokens: 200,
        costUsd: null,
        cachedPromptTokens: null,
        upstreamPromptCostUsd: null,
        upstreamCompletionCostUsd: null,
        isByok: null,
      },
    })
    await run()
    const failure = phases.at(-1)!
    expect(failure.phase).toBe("failed")
    expect(failure.message).toContain("openai/gpt-oss-20b")
    expect(failure.message).toContain("Max tokens")
  })

  test("only the first failure of a streak carries a message, and then the trip", async () => {
    completeImpl = async () => {
      throw new Error("blip")
    }
    await run()
    await run()
    await run()
    const failures = phases.filter((p) => p.phase !== "checking")
    expect(failures.map((p) => p.phase)).toEqual([
      "failed",
      "failed",
      "stopped",
    ])
    // Told once when it starts going wrong, once when it gives up, and never
    // twice for the same news.
    expect(failures[0]!.message).not.toBeNull()
    expect(failures[1]!.message).toBeNull()
    expect(failures[2]!.message).toContain("stopped")
  })

  test("editing the bundle revives a story that had given up", async () => {
    completeImpl = async () => {
      throw new Error("model retired")
    }
    await run()
    await run()
    await run()
    expect(completeCalls).toHaveLength(3)

    // The Settings change that FIXES a broken picker has to be able to undo
    // the breaker it tripped — otherwise only a server restart could.
    clearAtmosphereBreaker()
    completeImpl = async () => ({
      text: "keep",
      generationId: null,
      usage: null,
    })
    currentStory = makeStory({ wordCount: 1200 })
    await run()
    expect(completeCalls).toHaveLength(4)
  })
})

describe("one at a time", () => {
  test("a second check for the same story is dropped, not queued", async () => {
    let release = (): void => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    completeImpl = async () => {
      await held
      return { text: "rose", generationId: null, usage: null }
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
    expect(written).toHaveLength(1)
  })
})
