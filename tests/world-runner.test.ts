import { beforeEach, expect, mock, test } from "bun:test"
import { MOCK_STORIES, MOCK_LOREBOOK_ENTRIES } from "@/lib/mock-data"
import type { WorldIo } from "@/lib/generation/world"
import type { WorldPatch } from "@/lib/world/fold"
import type { WorldOp } from "@/lib/services/world.schema"
mock.module("server-only", () => ({}))
const { runWorldForStory, resetWorldState } =
  await import("@/lib/generation/world")
const SUMMARIZER = {
  modelId: null,
  thinking: "off" as const,
  providerTag: null,
  zdr: false,
  temperature: 0.2,
  targetWords: null,
  maxTokens: null,
}
const NPC = {
  ...MOCK_LOREBOOK_ENTRIES[0],
  id: "npc",
  npc: true,
  category: "character" as const,
  keys: ["Vell"],
}
const passage = {
  ...MOCK_STORIES[0].entries[0],
  id: "passage",
  position: 1,
  source: "generated" as const,
  text: "Vell hears the bell after ten minutes.",
}
const story = {
  ...MOCK_STORIES[0],
  id: "world-runner",
  features: {
    world: { enabled: true, pacing: "Conversations take a few minutes." },
  },
  entries: [
    {
      ...passage,
      id: "turn",
      position: 0,
      source: "user" as const,
      text: "You ask Vell about the bell.",
    },
    passage,
  ],
}
function rig() {
  const patches: WorldPatch[] = []
  const written: WorldOp[][] = []
  const opened: unknown[] = [],
    settled: unknown[] = [],
    announced: string[] = [],
    requests: Parameters<WorldIo["complete"]>[0][] = []
  const io: WorldIo = {
    getStory: async () => story,
    load: async () => ({
      entries: [
        { ...passage, variantGroupId: "slot", isActive: true, deletedAt: null },
      ],
      lore: [NPC],
      patches,
      state: { storyId: story.id, minutes: 0, npcs: [] },
    }),
    settings: async () => ({
      summarizer: {
        ...SUMMARIZER,
        modelId: "ollama:test",
        thinking: "off",
        maxTokens: 2048,
      },
    }),
    apiKey: () => "",
    complete: async (request) => {
      requests.push(request)
      return {
        text: JSON.stringify({
          minutesElapsed: 10,
          npcs: [
            {
              loreEntryId: "npc",
              mind: "I feel uneasy and want to find the bell.",
              memories: [{ text: "I heard the bell.", importance: 4 }],
            },
          ],
        }),
        truncated: false,
        generationId: "g",
        usage: null,
      }
    },
    openCall: async (call) => {
      opened.push(call)
    },
    settle: async (_id, outcome) => {
      settled.push(outcome)
    },
    store: async (_story, entryId, ops) => {
      patches.push({
        id: crypto.randomUUID(),
        entryId,
        source: "world",
        ops,
        createdAt: "1",
      })
      written.push(ops)
      return true
    },
    announce: (id) => {
      announced.push(id)
    },
  }
  return { io, patches, written, opened, settled, announced, requests }
}
beforeEach(resetWorldState)
test("uses summarizer settings, present cards and player turn; validates and commits clock then NPC ops", async () => {
  const r = rig()
  await runWorldForStory(story.id, passage.id, r.io)
  expect(r.opened[0]).toMatchObject({
    requestKind: "world",
    modelId: "ollama:test",
    subjectGroupId: passage.variantGroupId,
  })
  expect(r.requests[0]).toMatchObject({
    modelId: "ollama:test",
    key: "",
    maxTokens: 2048,
    thinking: "off",
  })
  const input = JSON.parse(r.requests[0].user)
  expect(input.playerTurn).toContain("ask Vell")
  expect(input.npcs[0]).toMatchObject({ loreEntryId: "npc", card: NPC.content })
  expect(r.written[0]).toMatchObject([
    { type: "set-clock", minutes: 480 },
    { type: "set-mind", loreEntryId: "npc" },
    {
      type: "add-memory",
      loreEntryId: "npc",
      memory: { text: "I heard the bell.", importance: 4 },
    },
  ])
  expect(r.announced).toEqual([story.id])
  expect(r.settled).toEqual([{ status: "ok", generationId: "g", usage: null }])
})
test("model and key resolve identically for OpenRouter, with the story retention floor", async () => {
  const r = rig()
  r.io.settings = async () => ({
    summarizer: { ...SUMMARIZER, modelId: "provider/model", zdr: false },
  })
  r.io.getStory = async () => ({
    ...story,
    settings: { ...story.settings, zdr: true },
  })
  r.io.apiKey = (modelId) => {
    expect(modelId).toBe("provider/model")
    return "test-only"
  }
  await runWorldForStory(story.id, passage.id, r.io)
  expect(r.requests[0]).toMatchObject({
    modelId: "provider/model",
    key: "test-only",
    zdr: true,
  })
})
test("off, missing passage, no key, and an existing world patch make no model call", async () => {
  for (const mode of ["off", "missing", "key", "dedupe"] as const) {
    const r = rig()
    if (mode === "off") r.io.getStory = async () => ({ ...story, features: {} })
    if (mode === "missing")
      r.io.getStory = async () => ({ ...story, entries: [] })
    if (mode === "key") r.io.apiKey = () => null
    if (mode === "dedupe") {
      const load = r.io.load
      r.io.load = async (id) => ({
        ...(await load(id)),
        patches: [
          {
            id: "p",
            source: "world",
            entryId: passage.id,
            ops: [],
            createdAt: "0",
          },
        ],
      })
    }
    await runWorldForStory(story.id, passage.id, r.io)
    expect(r.opened).toEqual([])
    expect(r.written).toEqual([])
  }
})
test("invalid, truncated, absent NPC, duplicate NPC and out-of-range answers write nothing and settle error", async () => {
  const validNpc = { loreEntryId: "npc", mind: "Waiting", memories: [] }
  const answers = [
    "bad json",
    JSON.stringify({ minutesElapsed: 1, npcs: [] }),
    JSON.stringify({ minutesElapsed: -1, npcs: [] }),
    JSON.stringify({ minutesElapsed: 1.5, npcs: [] }),
    JSON.stringify({
      minutesElapsed: 1,
      npcs: [{ ...validNpc, loreEntryId: "offstage" }],
    }),
    JSON.stringify({ minutesElapsed: 1, npcs: [validNpc, validNpc] }),
    JSON.stringify({
      minutesElapsed: 1,
      npcs: [{ ...validNpc, memories: [{ text: "I saw it", importance: 6 }] }],
    }),
  ]
  for (const answer of [...answers, "truncated"]) {
    resetWorldState()
    const r = rig()
    r.io.complete = async () => ({
      text: answer === "truncated" ? '{"minutesElapsed":1,"npcs":[]}' : answer,
      truncated: answer === "truncated",
      generationId: "bad",
      usage: null,
    })
    await runWorldForStory(story.id, passage.id, r.io)
    expect(r.written).toEqual([])
    expect(r.announced).toEqual([])
    expect(r.settled).toEqual([
      { status: "error", generationId: "bad", usage: null },
    ])
  }
})
test("presence uses only enabled opted-in character keys in this passage or player turn", async () => {
  const r = rig(),
    load = r.io.load
  r.io.load = async (id) => ({
    ...(await load(id)),
    lore: [
      { ...NPC, keys: ["not-here"], alwaysActive: true },
      { ...NPC, id: "off", npc: false },
      { ...NPC, id: "disabled", enabled: false },
      { ...NPC, id: "location", category: "location" },
    ],
  })
  r.io.complete = async (request) => {
    r.requests.push(request)
    return {
      text: '{"minutesElapsed":3,"npcs":[]}',
      truncated: false,
      generationId: null,
      usage: null,
    }
  }
  await runWorldForStory(story.id, passage.id, r.io)
  expect(JSON.parse(r.requests[0].user).npcs).toEqual([])
  expect(r.written[0]).toEqual([{ type: "set-clock", minutes: 480 }])
})
test("does not announce when a stale take or dedupe loses the commit", async () => {
  const r = rig()
  r.io.store = async () => false
  await runWorldForStory(story.id, passage.id, r.io)
  expect(r.announced).toEqual([])
  expect(r.settled[0]).toMatchObject({ status: "ok" })
})
test("duplicate triggers stay serial, and three failures trip the breaker without throwing", async () => {
  const r = rig()
  let release!: () => void
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  r.io.complete = async () => {
    await pending
    throw new Error("provider down")
  }
  const first = runWorldForStory(story.id, passage.id, r.io)
  await runWorldForStory(story.id, passage.id, r.io)
  release()
  await first
  await runWorldForStory(story.id, passage.id, r.io)
  await runWorldForStory(story.id, passage.id, r.io)
  await runWorldForStory(story.id, passage.id, r.io)
  expect(r.opened).toHaveLength(3)
  expect(r.settled).toHaveLength(3)
  expect(r.written).toEqual([])
})

test("input uses the prefix clock, mind and six newest memories, excluding later patches", async () => {
  const r = rig()
  const load = r.io.load
  r.io.load = async (id) => ({
    ...(await load(id)),
    patches: [
      {
        id: "initial",
        source: "manual",
        entryId: null,
        createdAt: "0",
        ops: [
          { type: "set-clock", minutes: 17 },
          { type: "set-mind", loreEntryId: "npc", mind: "I want shelter." },
          ...Array.from({ length: 9 }, (_, i): WorldOp => ({
            type: "add-memory",
            loreEntryId: "npc",
            memory: { id: `m${i}`, text: `I heard bell ${i}.`, importance: 2 },
          })),
        ],
      },
      {
        id: "future",
        source: "world",
        entryId: "future-passage",
        createdAt: "1",
        ops: [{ type: "advance-clock", minutes: 999 }],
      },
    ],
    entries: [
      ...(await load(id)).entries,
      {
        ...passage,
        id: "future-passage",
        position: 3,
        variantGroupId: "future",
        isActive: true,
        deletedAt: null,
      },
    ],
  })
  await runWorldForStory(story.id, passage.id, r.io)
  const input = JSON.parse(r.requests[0].user)
  expect(input.minutes).toBe(17)
  expect(input.npcs[0].mind).toBe("I want shelter.")
  expect(input.npcs[0].memories.map((m: { id: string }) => m.id)).toEqual([
    "m3",
    "m4",
    "m5",
    "m6",
    "m7",
    "m8",
  ])
})

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function manuscriptRig(count: number) {
  const r = rig()
  const entries = Array.from({ length: count }, (_, i) => ({
    ...passage,
    id: `p${i}`,
    position: i + 1,
    text: `Vell hears bell ${i}.`,
    variantGroupId: `slot${i}`,
    isActive: true,
    deletedAt: null as string | null,
  }))
  const load = r.io.load
  r.io.getStory = async () => ({
    ...story,
    entries: entries.filter((e) => e.isActive && e.deletedAt === null),
  })
  r.io.load = async (id) => ({ ...(await load(id)), entries })
  return { ...r, entries }
}

test("overlapping passages drain serially in manuscript order with the preceding patch in their input", async () => {
  const r = manuscriptRig(1)
  const entered = deferred(),
    release = deferred()
  const complete = r.io.complete
  r.io.complete = async (request) => {
    if (r.requests.length === 0) {
      entered.resolve()
      await release.promise
    }
    return complete(request)
  }
  const first = runWorldForStory(story.id, "p0", r.io)
  await entered.promise
  r.entries.push({
    ...r.entries[0],
    id: "p1",
    position: 2,
    variantGroupId: "slot1",
  })
  await runWorldForStory(story.id, "p1", r.io)
  expect(r.opened).toHaveLength(1)
  release.resolve()
  await first
  expect(r.patches.map((p) => p.entryId)).toEqual(["p0", "p1"])
  expect(r.written[1][0]).toEqual({ type: "advance-clock", minutes: 10 })
  expect(JSON.parse(r.requests[1].user)).toMatchObject({
    minutes: 480,
    clockInitialized: true,
  })
})

test("catch-up processes the oldest four missing live passages before the requested one", async () => {
  const r = manuscriptRig(400)
  r.entries[0].isActive = false
  await runWorldForStory(story.id, "p399", r.io)
  expect(r.patches.map((p) => p.entryId)).toEqual([
    "p1",
    "p2",
    "p3",
    "p4",
    "p399",
  ])
  expect(r.opened).toHaveLength(5)
})

test("queued passages are rechecked for deleted takes and existing patches before calling", async () => {
  const r = manuscriptRig(1)
  const entered = deferred(),
    release = deferred()
  const complete = r.io.complete
  r.io.complete = async (request) => {
    entered.resolve()
    await release.promise
    return complete(request)
  }
  const first = runWorldForStory(story.id, "p0", r.io)
  await entered.promise
  for (let i = 1; i <= 2; i++) {
    r.entries.push({ ...r.entries[0], id: `p${i}`, position: i + 1 })
    await runWorldForStory(story.id, `p${i}`, r.io)
  }
  r.entries[1].deletedAt = "deleted"
  r.patches.push({
    id: "existing",
    source: "world",
    entryId: "p2",
    ops: [],
    createdAt: "0",
  })
  release.resolve()
  await first
  expect(r.opened).toHaveLength(1)
})

test("a stale prefix retries once with fresh input; repeated staleness writes and announces nothing", async () => {
  for (const alwaysStale of [false, true]) {
    resetWorldState()
    const r = rig(),
      store = r.io.store
    const revisions: string[] = []
    r.io.store = async (storyId, entryId, ops, revision) => {
      revisions.push(revision)
      if (revisions.length === 1)
        r.patches.push({
          id: "correction",
          entryId: null,
          source: "manual",
          createdAt: "0",
          ops: [{ type: "set-clock", minutes: 900 }],
        })
      if (revisions.length === 1 || alwaysStale) return "stale"
      return store(storyId, entryId, ops, revision)
    }
    await runWorldForStory(story.id, passage.id, r.io)
    expect(r.requests).toHaveLength(2)
    expect(revisions[0]).not.toBe(revisions[1])
    expect(JSON.parse(r.requests[1].user)).toMatchObject({
      minutes: 900,
      clockInitialized: true,
    })
    expect(r.written).toHaveLength(alwaysStale ? 0 : 1)
    expect(r.announced).toHaveLength(alwaysStale ? 0 : 1)
  }
})

test("the first clock uses the passage's ending time or defaults to 08:00, and subsequent clocks advance", async () => {
  for (const minuteOfDay of [0, 1080, 1439, undefined]) {
    const r = rig(),
      complete = r.io.complete
    r.io.complete = async (request) => {
      const result = await complete(request)
      return {
        ...result,
        text: JSON.stringify({ ...JSON.parse(result.text), minuteOfDay }),
      }
    }
    await runWorldForStory(story.id, passage.id, r.io)
    expect(JSON.parse(r.requests[0].user).clockInitialized).toBe(false)
    expect(r.requests[0].system).toContain("END of the passage")
    expect(r.written[0][0]).toEqual({
      type: "set-clock",
      minutes: minuteOfDay ?? 480,
    })
  }
  const r = rig()
  r.patches.push({
    id: "zero",
    entryId: null,
    source: "manual",
    createdAt: "0",
    ops: [{ type: "set-clock", minutes: 0 }],
  })
  await runWorldForStory(story.id, passage.id, r.io)
  expect(r.written[0][0]).toEqual({ type: "advance-clock", minutes: 10 })
})

test("invalid initial times fail validation without writing", async () => {
  for (const minuteOfDay of [-1, 1440, 1.5]) {
    resetWorldState()
    const r = rig(),
      complete = r.io.complete
    r.io.complete = async (request) => {
      const result = await complete(request)
      return {
        ...result,
        text: JSON.stringify({ ...JSON.parse(result.text), minuteOfDay }),
      }
    }
    await runWorldForStory(story.id, passage.id, r.io)
    expect(r.written).toEqual([])
    expect(r.settled[0]).toMatchObject({ status: "error" })
  }
})

test("a failed earlier pass stops the drain, and the next turn retries it first", async () => {
  const r = manuscriptRig(3)
  const complete = r.io.complete
  let fail = true
  r.io.complete = async (request) => {
    if (fail && request.user.includes("bell 0")) throw new Error("down")
    return complete(request)
  }
  await runWorldForStory(story.id, "p1", r.io)
  expect(r.patches).toEqual([])
  fail = false
  await runWorldForStory(story.id, "p2", r.io)
  expect(r.patches.map((p) => p.entryId)).toEqual(["p0", "p1", "p2"])
})
