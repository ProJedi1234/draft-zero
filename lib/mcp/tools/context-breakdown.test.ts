// lib/mcp/tools/context-breakdown.test.ts — handler shaping logic against
// mocked queries and mocked lib/actions/context + lib/generation/breakdown.
// No live DB.
import { beforeEach, describe, expect, mock, test } from "bun:test"

import { installQueryMocks, stubQueries } from "@/lib/mcp/tools/test-queries"

/* -------------------------------------------------------------------------- */
/* Mocks — declared before importing the module under test                   */
/* -------------------------------------------------------------------------- */

interface FakeStory {
  entries: { id: string; position: number }[]
  settings: { loreBudget: number; contextWindow: number }
}

const getStoryFullMock = mock(
  async (_id: string): Promise<FakeStory | null> => null
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

installQueryMocks()

const loadEntryContextMock = mock(
  async (_storyId: string, _entryId: string) =>
    ({
      ok: true as const,
      data: {
        context: FAKE_COMPOSED_CONTEXT,
        contextWindow: 8000,
        modelId: "some-model",
      },
    }) as
      | {
          ok: true
          data: {
            context: unknown
            contextWindow: number
            modelId: string | null
          } | null
        }
      | { ok: false; error: string }
)
mock.module("@/lib/actions/context", () => ({
  loadEntryContext: loadEntryContextMock,
}))

const describeContextMock = mock(
  (_ctx: unknown, _windowTokens: number) => FAKE_BREAKDOWN
)
mock.module("@/lib/generation/breakdown", () => ({
  describeContext: describeContextMock,
}))

const { registerContextBreakdown } =
  await import("@/lib/mcp/tools/context-breakdown")

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const FAKE_COMPOSED_CONTEXT = {
  // Two lore entries triggered, only one survived the budget — the shape
  // droppedLore is computed from.
  fit: {
    loreMatched: 2,
    loreStableMatched: 1,
    storyChars: 500,
    storyCharsKept: 500,
  },
  lore: [{ id: "lore-1", name: "Vell" }],
}

const FAKE_BREAKDOWN = {
  sections: [
    {
      id: "system" as const,
      label: "Instructions",
      tokens: 50,
      chars: 200,
      text: "",
      fit: null,
      fitNote: "",
      items: [],
    },
    {
      id: "memory" as const,
      label: "Memory",
      tokens: 10,
      chars: 40,
      text: "",
      fit: null,
      fitNote: "",
      items: [],
    },
    {
      id: "lore" as const,
      label: "Lorebook",
      tokens: 30,
      chars: 120,
      text: "",
      fit: 0.5,
      fitNote: "",
      items: [
        {
          id: "lore-1",
          label: "Vell",
          tokens: 30,
          matchedKey: "vell",
          triggeredBy: null,
          depth: 0,
          stable: true,
          text: "",
        },
      ],
    },
    {
      id: "story" as const,
      label: "Story",
      tokens: 100,
      chars: 400,
      text: "",
      fit: 1,
      fitNote: "",
      items: [],
    },
  ],
  spans: [],
  usedTokens: 190,
  windowTokens: 8000,
  freeTokens: 7810,
  overflowing: false,
  cacheableTokens: 60,
}

const STORY: FakeStory = {
  entries: [
    { id: "entry-1", position: 1 },
    { id: "entry-5", position: 5 },
  ],
  settings: { loreBudget: 20, contextWindow: 8000 },
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
    resolveStoryRecap: resolveStoryRecapMock,
  })
  getStoryFullMock.mockClear()
  resolveStoryRecapMock.mockClear()
  loadEntryContextMock.mockClear()
  describeContextMock.mockClear()
  getStoryFullMock.mockImplementation(async () => STORY)
  resolveStoryRecapMock.mockImplementation(async () => RECAP)
  loadEntryContextMock.mockImplementation(async () => ({
    ok: true as const,
    data: {
      context: FAKE_COMPOSED_CONTEXT,
      contextWindow: 8000,
      modelId: "some-model",
    },
  }))
  describeContextMock.mockImplementation(() => FAKE_BREAKDOWN)
})

describe("context_breakdown", () => {
  test("defaults to the newest passage and shapes sections, lore, recap", async () => {
    const handler = registeredHandler()

    const result = await handler({ storyId: "story-1" })

    expect(loadEntryContextMock).toHaveBeenCalledWith("story-1", "entry-5")
    expect(result.isError).toBeUndefined()
    const data = result.structuredContent as Record<string, unknown>
    expect(data.position).toBe(5)
    expect(data.recap).toEqual({
      id: "recap-1",
      throughPosition: 3,
      createdAt: "2026-08-01T00:00:00.000Z",
    })
    expect(data.sections).toEqual([
      { name: "systemPrompt", tokens: 50, chars: 200 },
      { name: "memory", tokens: 10, chars: 40 },
      { name: "lore", tokens: 30, chars: 120 },
      { name: "manuscript", tokens: 100, chars: 400 },
    ])
    expect(data.memory).toEqual({ present: true, tokens: 10 })
    // No authorsNote section in the fixture breakdown — absent, not zeroed
    // silently: `present` says so explicitly.
    expect(data.authorsNote).toEqual({ present: false, tokens: 0 })
    expect(data.lore).toEqual([
      { id: "lore-1", name: "Vell", triggeredBy: ["vell"], tokens: 30 },
    ])
    // 2 triggered, 1 kept.
    expect(data.droppedLore).toBe(1)
    expect(data.loreBudget).toBe(20)
    expect(data.totalTokens).toBe(190)
    expect(data.contextWindow).toBe(8000)
  })

  test("resolves a given position instead of the newest", async () => {
    const handler = registeredHandler()

    await handler({ storyId: "story-1", position: 1 })

    expect(loadEntryContextMock).toHaveBeenCalledWith("story-1", "entry-1")
  })

  test("an unknown position fails without calling loadEntryContext", async () => {
    const handler = registeredHandler()

    const result = await handler({ storyId: "story-1", position: 999 })

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("999")
    expect(loadEntryContextMock).not.toHaveBeenCalled()
  })

  test("an unknown story fails before touching loadEntryContext", async () => {
    getStoryFullMock.mockImplementation(async () => null)
    const handler = registeredHandler()

    const result = await handler({ storyId: "nope" })

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("No story with id nope")
    expect(loadEntryContextMock).not.toHaveBeenCalled()
  })

  test("a story with no passages yet fails with a helpful message", async () => {
    getStoryFullMock.mockImplementation(async () => ({
      entries: [],
      settings: { loreBudget: 20, contextWindow: 8000 },
    }))
    const handler = registeredHandler()

    const result = await handler({ storyId: "story-1" })

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("no passages yet")
  })

  test("surfaces a loadEntryContext failure as failed(), not a throw", async () => {
    loadEntryContextMock.mockImplementation(async () => ({
      ok: false as const,
      error: "Couldn't work out the context for this passage.",
    }))
    const handler = registeredHandler()

    const result = await handler({ storyId: "story-1" })

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("Couldn't work out the context")
  })
})
