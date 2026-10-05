// lib/mcp/tools/list-stories.test.ts — handler shaping logic against mocked
// queries. No live DB, no HTTP.
import { beforeEach, describe, expect, mock, test } from "bun:test"
import type { ZodType } from "zod"

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
      createdAt: "2026-01-01",
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

  describe("sort and order", () => {
    // Each key ranks a, b, c differently, so a test can only pass on its own key.
    const fixture = () => [
      story({
        id: "a",
        title: "beta",
        createdAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z",
        wordCount: 300,
      }),
      story({
        id: "b",
        title: "Alpha",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
        wordCount: 100,
      }),
      story({
        id: "c",
        title: "gamma",
        createdAt: "2026-02-01T00:00:00.000Z",
        updatedAt: "2026-05-01T00:00:00.000Z",
        wordCount: 200,
      }),
    ]
    const passages = new Map([
      ["a", 2],
      ["b", 9],
      ["c", 5],
    ])

    beforeEach(() => {
      listStoriesWithCountsMock.mockImplementation(async () => fixture())
      countLivePassagesByStoryMock.mockImplementation(async () => passages)
    })

    async function ids(args: Record<string, unknown>) {
      const result = await registeredHandler()(args)
      const rows = result.structuredContent?.stories as Array<{ id: string }>
      return rows.map((r) => r.id)
    }

    test.each([
      ["updated", "desc", ["b", "c", "a"]],
      ["updated", "asc", ["a", "c", "b"]],
      ["created", "desc", ["a", "c", "b"]],
      ["created", "asc", ["b", "c", "a"]],
      ["title", "asc", ["b", "a", "c"]],
      ["title", "desc", ["c", "a", "b"]],
      ["words", "desc", ["a", "c", "b"]],
      ["words", "asc", ["b", "c", "a"]],
      ["passages", "desc", ["b", "c", "a"]],
      ["passages", "asc", ["a", "c", "b"]],
    ])("%s %s", async (sort, order, expected) => {
      expect(await ids({ sort, order })).toEqual(expected)
    })

    test("defaults to newest updated first, ignoring the query's order", async () => {
      expect(await ids({})).toEqual(["b", "c", "a"])
    })

    test("order defaults to asc for title and desc for everything else", async () => {
      expect(await ids({ sort: "title" })).toEqual(["b", "a", "c"])
      expect(await ids({ sort: "words" })).toEqual(["a", "c", "b"])
      expect(await ids({ sort: "created" })).toEqual(["a", "c", "b"])
    })

    test("ties break on id in both directions", async () => {
      listStoriesWithCountsMock.mockImplementation(async () => [
        story({ id: "z", wordCount: 50 }),
        story({ id: "m", wordCount: 50 }),
        story({ id: "q", wordCount: 50 }),
      ])
      expect(await ids({ sort: "words" })).toEqual(["m", "q", "z"])
      expect(await ids({ sort: "words", order: "asc" })).toEqual([
        "m",
        "q",
        "z",
      ])
    })

    test("a cursor pages through the sorted order", async () => {
      const handler = registeredHandler()
      const first = await handler({ sort: "words", limit: 2 })
      const firstIds = (
        first.structuredContent?.stories as { id: string }[]
      ).map((r) => r.id)
      const second = await handler({
        sort: "words",
        limit: 2,
        cursor: first.structuredContent?.nextCursor,
      })
      const secondIds = (
        second.structuredContent?.stories as { id: string }[]
      ).map((r) => r.id)
      expect([...firstIds, ...secondIds]).toEqual(["a", "c", "b"])
    })

    test("the summary names a non-default order and stays quiet on the default", async () => {
      const handler = registeredHandler()
      const sorted = await handler({ sort: "words" })
      expect(sorted.content[0]?.text).toBe(
        "3 stories · 3 returned · by words, desc"
      )
      const plain = await handler({})
      expect(plain.content[0]?.text).toBe("3 stories · 3 returned")
    })

    test("rejects an unknown sort key at the schema", async () => {
      let schema: ZodType | undefined
      registerListStories(
        {
          registerTool: (_n: string, config: { inputSchema: ZodType }) => {
            schema = config.inputSchema
          },
        } as never,
        {} as never
      )
      expect(schema?.safeParse({ sort: "rating" }).success).toBe(false)
      expect(schema?.safeParse({ sort: "words", order: "up" }).success).toBe(
        false
      )
    })
  })
})
