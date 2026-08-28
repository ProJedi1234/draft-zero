// lib/mcp/tools/story-map.test.ts — handler shaping logic against mocked
// queries. No live DB, no HTTP.
import { beforeEach, describe, expect, mock, test } from "bun:test"

import { installQueryMocks, stubQueries } from "@/lib/mcp/tools/test-queries"

/* -------------------------------------------------------------------------- */
/* Mocks — declared before importing the module under test                   */
/* -------------------------------------------------------------------------- */

type FakeStory = {
  id: string
  title: string
  genre: string
  description: string
  summary: string
  memory: string
  authorsNote: string
  entries: unknown[]
  entriesBefore?: number
  images: unknown[]
  wordCount: number
  settings: {
    modelId: string
    contextWindow: number
    loreBudget: number
    temperature: number
  }
}

type FakeLore = {
  id: string
  name: string
  keys: string[]
  content: string
  enabled: boolean
  alwaysActive: boolean
}

const getStoryMock = mock(async (_id: string) => null as FakeStory | null)
const listLorebookEntriesMock = mock(
  async (_storyId: string) => [] as FakeLore[]
)

const getManuscriptBoundsMock = mock(async (_storyId: string) => ({
  first: 0,
  last: -1,
  empty: true,
}))

installQueryMocks()

const { registerStoryMap } = await import("@/lib/mcp/tools/story-map")

/* -------------------------------------------------------------------------- */
/* Harness — a fake McpServer that just records the registered handler       */
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
  registerStoryMap(server as never, {} as never)
  if (!handler) throw new Error("story_map did not register")
  return handler
}

function fakeStory(overrides: Partial<FakeStory> = {}): FakeStory {
  return {
    id: "s1",
    title: "Some Story",
    genre: "Fantasy",
    description: "A tale.",
    summary: "Recap so far.",
    memory: "Always remember this.",
    authorsNote: "Steer toward danger.",
    entries: [{}, {}, {}],
    entriesBefore: 4,
    images: [{}, {}],
    wordCount: 4200,
    settings: {
      modelId: "~anthropic/claude-sonnet-latest",
      contextWindow: 32000,
      loreBudget: 20,
      temperature: 0.8,
    },
    ...overrides,
  }
}

beforeEach(() => {
  stubQueries({
    getStory: getStoryMock,
    listLorebookEntries: listLorebookEntriesMock,
    getManuscriptBounds: getManuscriptBoundsMock,
  })
  getStoryMock.mockClear()
  listLorebookEntriesMock.mockClear()
  getManuscriptBoundsMock.mockClear()
  getStoryMock.mockImplementation(async () => null)
  listLorebookEntriesMock.mockImplementation(async () => [])
  getManuscriptBoundsMock.mockImplementation(async () => ({
    first: 0,
    last: -1,
    empty: true,
  }))
})

describe("story_map", () => {
  test("rejects an unknown storyId", async () => {
    const handler = registeredHandler()
    const result = await handler({ storyId: "nope" })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("No story with id nope")
    expect(listLorebookEntriesMock).not.toHaveBeenCalled()
  })

  test("shapes recap, memory, notes, lore index, counts and read-only settings", async () => {
    getStoryMock.mockImplementation(async () => fakeStory())
    listLorebookEntriesMock.mockImplementation(async () => [
      {
        id: "lore-1",
        name: "Vell",
        keys: ["vell", "the wanderer"],
        content: "Long lore text nobody should see here.",
        enabled: true,
        alwaysActive: false,
      },
    ])
    getManuscriptBoundsMock.mockImplementation(async () => ({
      first: 0,
      last: 6,
      empty: false,
    }))

    const handler = registeredHandler()
    const result = await handler({ storyId: "s1" })

    expect(result.isError).toBeUndefined()
    const data = result.structuredContent as Record<string, unknown>
    expect(data.recap).toBe("Recap so far.")
    expect(data.memory).toBe("Always remember this.")
    expect(data.authorsNote).toBe("Steer toward danger.")
    expect(data.firstPosition).toBe(0)
    expect(data.lastPosition).toBe(6)

    const lore = data.lore as Array<Record<string, unknown>>
    expect(lore).toEqual([
      {
        id: "lore-1",
        name: "Vell",
        keys: ["vell", "the wanderer"],
        enabled: true,
        alwaysActive: false,
      },
    ])
    // Full lore content never leaves this tool — only the index.
    expect(JSON.stringify(data)).not.toContain("Long lore text")

    expect(data.counts).toEqual({
      passages: 7, // entriesBefore (4) + entries.length (3)
      images: 2,
      lore: 1,
      words: 4200,
    })
    expect(data.generation).toEqual({
      model: "~anthropic/claude-sonnet-latest",
      contextWindow: 32000,
      loreBudget: 20,
      temperature: 0.8,
    })
  })

  test("an empty story reports -1 position bounds", async () => {
    getStoryMock.mockImplementation(async () =>
      fakeStory({ entries: [], entriesBefore: 0, images: [] })
    )
    getManuscriptBoundsMock.mockImplementation(async () => ({
      first: 0,
      last: -1,
      empty: true,
    }))

    const handler = registeredHandler()
    const result = await handler({ storyId: "s1" })
    const data = result.structuredContent as Record<string, unknown>
    expect(data.firstPosition).toBe(-1)
    expect(data.lastPosition).toBe(-1)
    expect((data.counts as Record<string, unknown>).passages).toBe(0)
  })
})
