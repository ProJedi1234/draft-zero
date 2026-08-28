// lib/mcp/tools/read.test.ts — handler shaping logic against mocked queries.
// No live DB, no HTTP.
import { beforeEach, describe, expect, mock, test } from "bun:test"

import type { ManuscriptSlot } from "@/lib/db/queries"
import { installQueryMocks, stubQueries } from "@/lib/mcp/tools/test-queries"

/* -------------------------------------------------------------------------- */
/* Mocks — declared before importing the module under test                   */
/* -------------------------------------------------------------------------- */

const getStoryTitleMock = mock(
  async (_id: string) => "Some Story" as string | null
)
const getManuscriptBoundsMock = mock(async (_storyId: string) => ({
  first: 0,
  last: -1,
  empty: true,
}))
const readManuscriptWindowMock = mock(
  async (
    _storyId: string,
    _from: number,
    _to: number,
    _limit: number,
    _take?: "head" | "tail"
  ) => [] as ManuscriptSlot[]
)

installQueryMocks()

const { registerRead } = await import("@/lib/mcp/tools/read")

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
  registerRead(server as never, {} as never)
  if (!handler) throw new Error("read did not register")
  return handler
}

/**
 * A story with the given live bounds, whose window read returns `slots`
 * clipped to whatever range the handler resolved and trimmed to `limit` rows
 * from the requested end — the real query does both in SQL, so the double has
 * to do them here or a tail-defaulting read would look like it returned rows
 * outside its own window, or more of them than it asked for.
 */
function storyWith(
  bounds: { first: number; last: number },
  slots: ManuscriptSlot[]
) {
  getManuscriptBoundsMock.mockImplementation(async () => ({
    ...bounds,
    empty: bounds.last < bounds.first,
  }))
  readManuscriptWindowMock.mockImplementation(
    async (_id, from, to, limit, take = "head") => {
      const inWindow = slots.filter(
        (slot) => slot.position >= from && slot.position <= to
      )
      return take === "tail" ? inWindow.slice(-limit) : inWindow.slice(0, limit)
    }
  )
}

beforeEach(() => {
  stubQueries({
    getStoryTitle: getStoryTitleMock,
    getManuscriptBounds: getManuscriptBoundsMock,
    readManuscriptWindow: readManuscriptWindowMock,
  })
  getStoryTitleMock.mockClear()
  getManuscriptBoundsMock.mockClear()
  readManuscriptWindowMock.mockClear()
  getStoryTitleMock.mockImplementation(async () => "Some Story")
  storyWith({ first: 0, last: -1 }, [])
})

describe("read", () => {
  test("rejects an unknown storyId before touching the manuscript", async () => {
    getStoryTitleMock.mockImplementation(async () => null)
    const handler = registeredHandler()
    const result = await handler({ storyId: "nope" })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("No story with id nope")
  })

  test("an empty story reads back an empty, non-hasMore window", async () => {
    const handler = registeredHandler()
    const result = await handler({ storyId: "s1" })
    expect(result.isError).toBeUndefined()
    const data = result.structuredContent as Record<string, unknown>
    expect(data.entries).toEqual([])
    expect(data.firstPosition).toBe(-1)
    expect(data.lastPosition).toBe(-1)
    expect(data.hasMore).toBe(false)
  })

  test("merges passages and images in position order, images as stubs", async () => {
    storyWith({ first: 0, last: 4 }, [
      { position: 0, kind: "narration", text: "It was a dark night." },
      { position: 1, kind: "say", text: '"Who goes there?"' },
      { position: 2, kind: "do", text: "You draw your sword." },
      {
        position: 3,
        kind: "image",
        text: "A moonlit courtyard, tense standoff",
      },
      { position: 4, kind: "narration", text: "The dawn broke." },
    ])

    const handler = registeredHandler()
    const result = await handler({ storyId: "s1" })
    const data = result.structuredContent as Record<string, unknown>
    const entries = data.entries as Array<Record<string, unknown>>

    expect(entries.map((e) => e.position)).toEqual([0, 1, 2, 3, 4])
    expect(entries.map((e) => e.kind)).toEqual([
      "narration",
      "say",
      "do",
      "image",
      "narration",
    ])
    expect(entries[3]?.text).toContain("A moonlit courtyard")
    expect(data.from).toBe(0)
    expect(data.to).toBe(4)
    expect(data.firstPosition).toBe(0)
    expect(data.lastPosition).toBe(4)
    expect(data.hasMore).toBe(false)
  })

  test("a lone `from` past the last live slot fails instead of inverting the window", async () => {
    // The shape a read takes right after a rewind: the model still holds a
    // position the story no longer has.
    storyWith({ first: 0, last: 5 }, [])

    const handler = registeredHandler()
    const result = await handler({ storyId: "s1", from: 40 })

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("past the last position 5")
    expect(result.structuredContent).toBeUndefined()
  })

  test("a lone `to` below the first live slot fails instead of inverting the window", async () => {
    storyWith({ first: 10, last: 20 }, [])

    const handler = registeredHandler()
    const result = await handler({ storyId: "s1", to: 3 })

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("before the first position 10")
  })

  test("a tail read returns `limit` rows even when positions are sparse", async () => {
    // The shape after a rewind: live rows at 0-5 and 20, the numbers between
    // them held by soft-deleted takes. Treating limit as a span of positions
    // would resolve to 11-20 and hand back a single entry.
    storyWith({ first: 0, last: 20 }, [
      ...Array.from({ length: 6 }, (_, i) => ({
        position: i,
        kind: "narration" as const,
        text: `Passage ${i}.`,
      })),
      { position: 20, kind: "narration", text: "After the rewind." },
    ])

    const handler = registeredHandler()
    const result = await handler({ storyId: "s1", limit: 5 })
    const data = result.structuredContent as Record<string, unknown>
    const entries = data.entries as Array<Record<string, unknown>>

    expect(entries.map((e) => e.position)).toEqual([2, 3, 4, 5, 20])
    expect(data.from).toBe(2)
    expect(data.to).toBe(20)
    expect(data.hasMore).toBe(true)
  })

  test("a start-to-end read pages instead of returning the manuscript", async () => {
    storyWith(
      { first: 0, last: 99 },
      Array.from({ length: 100 }, (_, i) => ({
        position: i,
        kind: "narration" as const,
        text: `Passage ${i}.`,
      }))
    )

    const handler = registeredHandler()
    const result = await handler({
      storyId: "s1",
      from: "start",
      to: "end",
      limit: 10,
    })
    const data = result.structuredContent as Record<string, unknown>
    const entries = data.entries as Array<Record<string, unknown>>

    expect(entries).toHaveLength(10)
    expect(data.from).toBe(0)
    expect(data.to).toBe(9)
    // The tail is still 99, so the model can see there is more ahead of it.
    expect(data.lastPosition).toBe(99)
    expect(data.hasMore).toBe(false)
  })

  test("flags hasMore when the resolved window starts after the story's first slot", async () => {
    storyWith({ first: 0, last: 20 }, [
      { position: 20, kind: "narration", text: "The end, for now." },
    ])

    const handler = registeredHandler()
    const result = await handler({ storyId: "s1", from: 20, to: 20 })
    const data = result.structuredContent as Record<string, unknown>
    expect(data.hasMore).toBe(true)
    expect(data.firstPosition).toBe(0)
    expect(data.lastPosition).toBe(20)
  })
})
