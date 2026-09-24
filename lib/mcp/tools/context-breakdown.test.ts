// lib/mcp/tools/context-breakdown.test.ts — handler shaping logic against
// mocked queries, with the real loadEntryContext service and the real
// describeContext composing what the tool reshapes. No live DB, no network.
import { beforeEach, describe, expect, mock, test } from "bun:test"

import { installQueryMocks, stubQueries } from "@/lib/mcp/tools/test-queries"
import { installEntriesDoubles } from "@/lib/services/entries-test-support"
import type { LorebookEntry, Story, StoryEntry } from "@/lib/types"

/* -------------------------------------------------------------------------- */
/* Doubles — declared before importing the module under test                  */
/* -------------------------------------------------------------------------- */

const getStoryFullMock = mock(
  async (_id: string): Promise<Story | null> => null
)
const listLorebookEntriesMock = mock(
  async (_id: string): Promise<LorebookEntry[]> => []
)
const resolveStoryRecapMock = mock(
  async (
    _id: string
  ): Promise<{
    id: string
    throughPosition: number
    createdAt: string
  } | null> => null
)

await installEntriesDoubles()
installQueryMocks()

const { registerContextBreakdown } =
  await import("@/lib/mcp/tools/context-breakdown")
const { loadEntryContext } = await import("@/lib/services/entries")

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

function passage(id: string, position: number, text: string): StoryEntry {
  return {
    id,
    position,
    source: "generated",
    text,
    actionKind: null,
    inputText: null,
    variantGroupId: id,
    variantIndex: 0,
    variantCount: 1,
    variantProfilesMixed: false,
    generation: null,
    costUsd: null,
    reasoningTokens: null,
    callStatus: null,
    createdAt: "2026-08-01T00:00:00.000Z",
  }
}

function lore(id: string, overrides: Partial<LorebookEntry> = {}) {
  return {
    id,
    storyId: "story-1",
    name: "Vell",
    category: "character",
    keys: ["vell"],
    content: "A wanderer with a grudge.",
    enabled: true,
    alwaysActive: false,
    priority: 50,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  } satisfies LorebookEntry
}

function story(overrides: Partial<Story> = {}): Story {
  return {
    id: "story-1",
    title: "Test",
    description: "",
    genre: "",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    wordCount: 0,
    tintHue: null,
    tintStrength: 1,
    tintAuto: true,
    entries: [
      passage("entry-1", 1, "Vell walked into the harbour at dusk."),
      passage("entry-5", 5, "The lamps came on one by one."),
    ],
    images: [],
    imageModelId: null,
    profileId: null,
    settings: {
      modelId: "~test/model",
      thinking: "off",
      providerTag: null,
      zdr: false,
      temperature: 1,
      topP: 1,
      contextWindow: 8192,
      loreBudget: 20,
      frequencyPenalty: 0,
      presencePenalty: 0,
    },
    memory: "The sea is cold here.",
    summarize: true,
    summary: "",
    authorsNote: "",
    systemPrompt: null,
    activeLorebookEntryIds: [],
    canUndo: false,
    canRedo: false,
    undoSummary: null,
    redoSummary: null,
    ...overrides,
  }
}

const RECAP = {
  id: "recap-1",
  throughPosition: 3,
  createdAt: "2026-08-01T00:00:00.000Z",
}

/* -------------------------------------------------------------------------- */
/* Harness                                                                    */
/* -------------------------------------------------------------------------- */

type ToolHandler = (
  args: unknown,
  ctx?: unknown
) => Promise<{
  isError?: boolean
  content: { type: string; text: string }[]
  structuredContent?: Record<string, unknown>
}>

function registeredHandler(): ToolHandler {
  let handler: ToolHandler | undefined
  const server = {
    registerTool: (_name: string, _config: unknown, h: ToolHandler) => {
      handler = h
    },
  }
  registerContextBreakdown(server as never, undefined as never)
  if (!handler) throw new Error("context_breakdown did not register")
  return handler
}

beforeEach(() => {
  stubQueries({
    getStoryFull: getStoryFullMock,
    listLorebookEntries: listLorebookEntriesMock,
    resolveStoryRecap: resolveStoryRecapMock,
  })
  getStoryFullMock.mockClear()
  listLorebookEntriesMock.mockClear()
  resolveStoryRecapMock.mockClear()
  getStoryFullMock.mockImplementation(async () => story())
  listLorebookEntriesMock.mockImplementation(async () => [lore("lore-1")])
  resolveStoryRecapMock.mockImplementation(async () => RECAP)
})

describe("context_breakdown", () => {
  test("defaults to the newest passage and shapes sections, lore, recap", async () => {
    const handler = registeredHandler()

    const result = await handler({ storyId: "story-1" })

    expect(result.isError).toBeUndefined()
    const data = result.structuredContent as Record<string, unknown>
    expect(data.position).toBe(5)
    expect(data.recap).toEqual(RECAP)
    // Only the passage BEFORE entry-5 was composed, and it names Vell.
    expect(
      (data.sections as { name: string }[]).map((section) => section.name)
    ).toEqual(["systemPrompt", "memory", "lore", "manuscript"])
    expect(data.memory).toMatchObject({ present: true })
    // No author's note in the fixture — absent, not zeroed silently.
    expect(data.authorsNote).toEqual({ present: false, tokens: 0 })
    expect(data.lore).toEqual([
      {
        id: "lore-1",
        name: "Vell",
        triggeredBy: ["vell"],
        tokens: expect.any(Number),
      },
    ])
    expect(data.droppedLore).toBe(0)
    // A percent of the leftover window, not a token count.
    expect(data.loreBudgetPercent).toBe(20)
    expect(data.totalTokens).toBeGreaterThan(0)
  })

  test("resolves a given position instead of the newest", async () => {
    const handler = registeredHandler()

    const result = await handler({ storyId: "story-1", position: 1 })

    // Nothing precedes entry-1, so no manuscript and no lore trigger.
    const data = result.structuredContent as Record<string, unknown>
    expect(data.position).toBe(1)
    expect(data.lore).toEqual([])
  })

  test("counts lore that triggered but lost the budget", async () => {
    const long = "A long history. ".repeat(400)
    listLorebookEntriesMock.mockImplementation(async () => [
      lore("lore-1", { content: long }),
      lore("lore-2", { name: "Vell's blade", content: long }),
    ])
    getStoryFullMock.mockImplementation(async () =>
      story({
        settings: { ...story().settings, contextWindow: 2048, loreBudget: 5 },
      })
    )
    const handler = registeredHandler()

    const result = await handler({ storyId: "story-1" })

    const direct = await loadEntryContext(
      { storyId: "story-1", entryId: "entry-5" },
      { origin: null }
    )
    if (!direct.ok || !direct.data) throw new Error("expected a context")
    const dropped =
      direct.data.context.fit.loreMatched - direct.data.context.lore.length
    expect(dropped).toBeGreaterThan(0)
    expect(result.structuredContent?.droppedLore).toBe(dropped)
  })

  test("an unknown position fails without composing a context", async () => {
    const handler = registeredHandler()

    const result = await handler({ storyId: "story-1", position: 999 })

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("999")
    expect(listLorebookEntriesMock).not.toHaveBeenCalled()
  })

  test("an unknown story fails before composing a context", async () => {
    getStoryFullMock.mockImplementation(async () => null)
    const handler = registeredHandler()

    const result = await handler({ storyId: "nope" })

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("No story with id nope")
    expect(listLorebookEntriesMock).not.toHaveBeenCalled()
  })

  test("a story with no passages yet fails with a helpful message", async () => {
    getStoryFullMock.mockImplementation(async () => story({ entries: [] }))
    const handler = registeredHandler()

    const result = await handler({ storyId: "story-1" })

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("no passages yet")
  })

  test("surfaces a loadEntryContext failure as failed(), not a throw", async () => {
    // The tool's own read succeeds; the service's second read does not.
    getStoryFullMock.mockImplementationOnce(async () => story())
    getStoryFullMock.mockImplementationOnce(async () => {
      throw new Error("connection reset")
    })
    const quiet = console.error
    console.error = () => {}
    const handler = registeredHandler()

    const result = await handler({ storyId: "story-1" })
    console.error = quiet

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("Couldn't work out the context")
  })
})
