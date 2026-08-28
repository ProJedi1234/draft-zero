// lib/mcp/tools/search.test.ts — handler shaping logic against mocked
// queries. No live DB, no HTTP.
import { beforeEach, describe, expect, mock, test } from "bun:test"

import { installQueryMocks, stubQueries } from "@/lib/mcp/tools/test-queries"

/* -------------------------------------------------------------------------- */
/* Mocks — declared before importing the module under test                   */
/* -------------------------------------------------------------------------- */

const getStoryTitleMock = mock(
  async (_id: string) => "Some Story" as string | null
)
const searchStoryEntriesMock = mock(
  async (_needle: string, _storyId?: string) =>
    [] as {
      storyId: string
      storyTitle: string
      position: number
      text: string
    }[]
)
const searchLorebookContentMock = mock(
  async (_needle: string, _storyId?: string) =>
    [] as {
      id: string
      storyId: string
      storyTitle: string
      name: string
      content: string
    }[]
)

// escapeLikeNeedle is left at the shared default, which is the real
// implementation: escaping is search.ts's contract with the query layer, and
// a double that skipped it would hide a needle it failed to escape.
installQueryMocks()

const { registerSearch } = await import("@/lib/mcp/tools/search")

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
  registerSearch(server as never, {} as never)
  if (!handler) throw new Error("search did not register")
  return handler
}

beforeEach(() => {
  stubQueries({
    getStoryTitle: getStoryTitleMock,
    searchStoryEntries: searchStoryEntriesMock,
    searchLorebookContent: searchLorebookContentMock,
  })
  getStoryTitleMock.mockClear()
  searchStoryEntriesMock.mockClear()
  searchLorebookContentMock.mockClear()
  getStoryTitleMock.mockImplementation(async () => "Some Story")
  searchStoryEntriesMock.mockImplementation(async () => [])
  searchLorebookContentMock.mockImplementation(async () => [])
})

describe("search", () => {
  test("rejects an unknown storyId before querying", async () => {
    getStoryTitleMock.mockImplementation(async () => null)
    const handler = registeredHandler()
    const result = await handler({ query: "dragon", storyId: "nope" })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("No story with id nope")
    expect(searchStoryEntriesMock).not.toHaveBeenCalled()
  })

  test("combines passage and lore hits, shaped and snippeted", async () => {
    searchStoryEntriesMock.mockImplementation(async () => [
      {
        storyId: "s1",
        storyTitle: "Some Story",
        position: 12,
        text: "The old dragon slept beneath the mountain for a thousand years, dreaming of gold and fire that had long since gone cold.",
      },
    ])
    searchLorebookContentMock.mockImplementation(async () => [
      {
        id: "lore-1",
        storyId: "s1",
        storyTitle: "Some Story",
        name: "Dragon",
        content: "A dragon is an ancient wyrm.",
      },
    ])

    const handler = registeredHandler()
    const result = await handler({ query: "dragon", storyId: "s1" })

    expect(result.isError).toBeUndefined()
    const hits = result.structuredContent?.hits as Array<
      Record<string, unknown>
    >
    expect(hits).toHaveLength(2)

    const passageHit = hits.find((h) => h.kind === "passage")
    expect(passageHit?.position).toBe(12)
    expect((passageHit?.snippet as string).toLowerCase()).toContain("dragon")
    expect((passageHit?.snippet as string).length).toBeLessThan(160)

    const loreHit = hits.find((h) => h.kind === "lore")
    expect(loreHit?.loreId).toBe("lore-1")
    expect(loreHit?.name).toBe("Dragon")

    expect(result.structuredContent?.total).toBe(2)
    expect(result.structuredContent?.nextCursor).toBeUndefined()
  })

  test("scope: passages skips the lore query entirely", async () => {
    const handler = registeredHandler()
    await handler({ query: "dragon", scope: "passages" })
    expect(searchLorebookContentMock).not.toHaveBeenCalled()
    expect(searchStoryEntriesMock).toHaveBeenCalledTimes(1)
  })

  test("scope: lore skips the passage query entirely", async () => {
    const handler = registeredHandler()
    await handler({ query: "dragon", scope: "lore" })
    expect(searchStoryEntriesMock).not.toHaveBeenCalled()
    expect(searchLorebookContentMock).toHaveBeenCalledTimes(1)
  })

  test("paginates hits and reports a cursor when more remain", async () => {
    searchStoryEntriesMock.mockImplementation(async () =>
      Array.from({ length: 3 }, (_, i) => ({
        storyId: "s1",
        storyTitle: "Some Story",
        position: i,
        text: `passage ${i} mentions dragon`,
      }))
    )

    const handler = registeredHandler()
    const first = await handler({ query: "dragon", storyId: "s1", limit: 2 })
    expect((first.structuredContent?.hits as unknown[]).length).toBe(2)
    expect(first.structuredContent?.total).toBe(3)
    const cursor = first.structuredContent?.nextCursor as string
    expect(cursor).toBeTruthy()

    const second = await handler({
      query: "dragon",
      storyId: "s1",
      limit: 2,
      cursor,
    })
    expect((second.structuredContent?.hits as unknown[]).length).toBe(1)
    expect(second.structuredContent?.nextCursor).toBeUndefined()
  })

  test("rejects a blank query", async () => {
    const handler = registeredHandler()
    const result = await handler({ query: "   " })
    expect(result.isError).toBe(true)
  })
})
