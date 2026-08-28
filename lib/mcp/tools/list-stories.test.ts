// lib/mcp/tools/list-stories.test.ts — handler shaping logic against mocked
// queries. No live DB, no HTTP.
import { beforeEach, describe, expect, mock, test } from "bun:test"

import { installQueryMocks, stubQueries } from "@/lib/mcp/tools/test-queries"

/* -------------------------------------------------------------------------- */
/* Mocks — declared before importing the module under test                   */
/* -------------------------------------------------------------------------- */

type StorySummaryRow = {
  id: string
  title: string
  description: string
  genre: string
  createdAt: string
  updatedAt: string
  wordCount?: number
  tintHue: number | null
  tintStrength: number
}

const listStoriesWithCountsMock = mock(async () => [] as StorySummaryRow[])
const countLivePassagesByStoryMock = mock(async () => new Map<string, number>())

installQueryMocks()

const { registerListStories } = await import("@/lib/mcp/tools/list-stories")

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
  registerListStories(server as never, {} as never)
  if (!handler) throw new Error("list_stories did not register")
  return handler
}

function story(overrides: Partial<StorySummaryRow> = {}): StorySummaryRow {
  return {
    id: "s1",
    title: "Some Story",
    description: "A tale.",
    genre: "Fantasy",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    wordCount: 100,
    tintHue: null,
    tintStrength: 0,
    ...overrides,
  }
}

beforeEach(() => {
  stubQueries({
    listStoriesWithCounts: listStoriesWithCountsMock,
    countLivePassagesByStory: countLivePassagesByStoryMock,
  })
  listStoriesWithCountsMock.mockClear()
  countLivePassagesByStoryMock.mockClear()
  listStoriesWithCountsMock.mockImplementation(async () => [])
  countLivePassagesByStoryMock.mockImplementation(async () => new Map())
})

describe("list_stories", () => {
  test("shapes rows with joined passage counts and word counts", async () => {
    listStoriesWithCountsMock.mockImplementation(async () => [story()])
    countLivePassagesByStoryMock.mockImplementation(
      async () => new Map([["s1", 7]])
    )

    const handler = registeredHandler()
    const result = await handler({})

    expect(result.isError).toBeUndefined()
    const rows = result.structuredContent?.stories as Array<
      Record<string, unknown>
    >
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: "s1",
      title: "Some Story",
      genre: "Fantasy",
      passages: 7,
      words: 100,
      updatedAt: "2026-01-02",
    })
    expect(result.structuredContent?.total).toBe(1)
  })

  test("a story with no live passages counts as zero, not missing", async () => {
    listStoriesWithCountsMock.mockImplementation(async () => [story()])

    const handler = registeredHandler()
    const result = await handler({})
    const rows = result.structuredContent?.stories as Array<
      Record<string, unknown>
    >
    expect(rows[0]?.passages).toBe(0)
  })

  test("query filters by title, genre or description, case-insensitively", async () => {
    listStoriesWithCountsMock.mockImplementation(async () => [
      story({ id: "s1", title: "Dragon's Keep" }),
      story({ id: "s2", title: "Ocean Voyage", genre: "Sea fantasy" }),
      story({
        id: "s3",
        title: "Quiet Town",
        description: "A dragon sleeps nearby.",
      }),
      story({ id: "s4", title: "Unrelated" }),
    ])

    const handler = registeredHandler()
    const result = await handler({ query: "DRAGON" })
    const rows = result.structuredContent?.stories as Array<
      Record<string, unknown>
    >
    expect(rows.map((r) => r.id).sort()).toEqual(["s1", "s3"])
  })

  test("paginates and reports a cursor when more remain", async () => {
    listStoriesWithCountsMock.mockImplementation(async () =>
      Array.from({ length: 3 }, (_, i) =>
        story({ id: `s${i}`, title: `Story ${i}` })
      )
    )

    const handler = registeredHandler()
    const first = await handler({ limit: 2 })
    expect((first.structuredContent?.stories as unknown[]).length).toBe(2)
    expect(first.structuredContent?.total).toBe(3)
    const cursor = first.structuredContent?.nextCursor as string
    expect(cursor).toBeTruthy()

    const second = await handler({ limit: 2, cursor })
    expect((second.structuredContent?.stories as unknown[]).length).toBe(1)
    expect(second.structuredContent?.nextCursor).toBeUndefined()
  })
})
