// lib/mcp/tools/lore.test.ts — handler shaping logic against mocked queries
// and mocked lib/actions/lorebook. No live DB, no HTTP.
import { beforeEach, describe, expect, mock, test } from "bun:test"

import { installQueryMocks, stubQueries } from "@/lib/mcp/tools/test-queries"

/* -------------------------------------------------------------------------- */
/* Mocks — declared before importing the module under test                   */
/* -------------------------------------------------------------------------- */

type FakeEntry = {
  id: string
  storyId: string
  name: string
  category: string
  keys: string[]
  content: string
  enabled: boolean
  alwaysActive: boolean
  priority: number
  createdAt: string
  updatedAt: string
}

const EXISTING: FakeEntry = {
  id: "lore-1",
  storyId: "s1",
  name: "Vell",
  category: "character",
  keys: ["vell", "the wanderer"],
  content: "A wandering swordswoman.",
  enabled: true,
  alwaysActive: false,
  priority: 50,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
}

const getLorebookEntryMock = mock(
  async (_id: string): Promise<FakeEntry | null> => null
)
const listLorebookEntriesMock = mock(
  async (_storyId: string): Promise<FakeEntry[]> => []
)

installQueryMocks()

const createLorebookEntryMock = mock(
  async (_storyId: string, _input: unknown) => ({
    ok: true as const,
    data: { id: "lore-new" },
  })
)
type WriteResult = { ok: true; data: null } | { ok: false; error: string }
const updateLorebookEntryMock = mock(
  async (_id: string, _patch: unknown): Promise<WriteResult> => ({
    ok: true,
    data: null,
  })
)

mock.module("@/lib/actions/lorebook", () => ({
  createLorebookEntry: createLorebookEntryMock,
  updateLorebookEntry: updateLorebookEntryMock,
}))

const { registerLoreGet, registerLoreWrite } =
  await import("@/lib/mcp/tools/lore")

/* -------------------------------------------------------------------------- */
/* Harness — a fake McpServer that records each registered handler by name   */
/* -------------------------------------------------------------------------- */

type ToolHandler = (
  args: unknown,
  ctx?: unknown
) => Promise<{
  isError?: boolean
  content: { type: string; text: string }[]
  structuredContent?: Record<string, unknown>
}>

function makeFakeServer() {
  const handlers = new Map<string, ToolHandler>()
  const server = {
    registerTool: (name: string, _config: unknown, handler: ToolHandler) => {
      handlers.set(name, handler)
    },
  }
  return { server, handlers }
}

beforeEach(() => {
  stubQueries({
    getLorebookEntry: getLorebookEntryMock,
    listLorebookEntries: listLorebookEntriesMock,
  })
  getLorebookEntryMock.mockClear()
  listLorebookEntriesMock.mockClear()
  createLorebookEntryMock.mockClear()
  updateLorebookEntryMock.mockClear()
  getLorebookEntryMock.mockImplementation(async () => null)
  listLorebookEntriesMock.mockImplementation(async () => [])
  createLorebookEntryMock.mockImplementation(async () => ({
    ok: true as const,
    data: { id: "lore-new" },
  }))
  updateLorebookEntryMock.mockImplementation(async () => ({
    ok: true,
    data: null,
  }))
})

describe("lore_get", () => {
  function handler() {
    const { server, handlers } = makeFakeServer()
    registerLoreGet(server as never, {} as never)
    const h = handlers.get("lore_get")
    if (!h) throw new Error("lore_get did not register")
    return h
  }

  test("reads by id, scoped to the given story", async () => {
    getLorebookEntryMock.mockImplementation(async () => EXISTING)
    const result = await handler()({ storyId: "s1", id: "lore-1" })
    expect(result.isError).toBeUndefined()
    expect(result.structuredContent).toMatchObject({
      id: "lore-1",
      name: "Vell",
      keys: ["vell", "the wanderer"],
    })
  })

  test("an id belonging to another story reads as not found", async () => {
    getLorebookEntryMock.mockImplementation(async () => ({
      ...EXISTING,
      storyId: "other-story",
    }))
    const result = await handler()({ storyId: "s1", id: "lore-1" })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("No lore entry with id")
  })

  test("reads by exact name when no id is given", async () => {
    listLorebookEntriesMock.mockImplementation(async () => [EXISTING])
    const result = await handler()({ storyId: "s1", name: "Vell" })
    expect(result.isError).toBeUndefined()
    expect(result.structuredContent?.id).toBe("lore-1")
  })

  test("an unmatched name fails with actionable advice", async () => {
    listLorebookEntriesMock.mockImplementation(async () => [])
    const result = await handler()({ storyId: "s1", name: "Nobody" })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("story_map")
  })

  test("requires id or name", async () => {
    const result = await handler()({ storyId: "s1" })
    expect(result.isError).toBe(true)
    expect(getLorebookEntryMock).not.toHaveBeenCalled()
  })
})

describe("lore_write", () => {
  function handler() {
    const { server, handlers } = makeFakeServer()
    registerLoreWrite(server as never, {} as never)
    const h = handlers.get("lore_write")
    if (!h) throw new Error("lore_write did not register")
    return h
  }

  test("creates a new entry when id is omitted", async () => {
    const result = await handler()({
      storyId: "s1",
      name: "Vell",
      category: "character",
      keys: ["vell"],
      content: "A wanderer.",
    })
    expect(result.isError).toBeUndefined()
    expect(createLorebookEntryMock).toHaveBeenCalledTimes(1)
    expect(createLorebookEntryMock.mock.calls[0]?.[0]).toBe("s1")
    expect(result.structuredContent).toMatchObject({
      id: "lore-new",
      name: "Vell",
      created: true,
    })
  })

  test("creating without a name fails before touching the db", async () => {
    const result = await handler()({ storyId: "s1" })
    expect(result.isError).toBe(true)
    expect(createLorebookEntryMock).not.toHaveBeenCalled()
  })

  test("updates only the fields that were actually passed and differ", async () => {
    getLorebookEntryMock.mockImplementation(async () => EXISTING)
    const result = await handler()({
      storyId: "s1",
      id: "lore-1",
      content: "A wandering swordswoman with a grudge.",
      priority: 50, // unchanged — must not appear in `changed`
    })
    expect(result.isError).toBeUndefined()
    expect(updateLorebookEntryMock).toHaveBeenCalledTimes(1)
    const [id, patch] = updateLorebookEntryMock.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ]
    expect(id).toBe("lore-1")
    expect(patch).toEqual({ content: "A wandering swordswoman with a grudge." })
    expect(result.structuredContent?.changed).toEqual(["content"])
  })

  test("a no-op update never calls updateLorebookEntry", async () => {
    getLorebookEntryMock.mockImplementation(async () => EXISTING)
    const result = await handler()({
      storyId: "s1",
      id: "lore-1",
      name: "Vell",
      keys: ["vell", "the wanderer"],
    })
    expect(result.isError).toBeUndefined()
    expect(updateLorebookEntryMock).not.toHaveBeenCalled()
    expect(result.structuredContent?.changed).toEqual([])
    expect(result.structuredContent?.created).toBe(false)
  })

  test("updating an id from another story fails without writing", async () => {
    getLorebookEntryMock.mockImplementation(async () => ({
      ...EXISTING,
      storyId: "other-story",
    }))
    const result = await handler()({
      storyId: "s1",
      id: "lore-1",
      content: "x",
    })
    expect(result.isError).toBe(true)
    expect(updateLorebookEntryMock).not.toHaveBeenCalled()
  })

  test("surfaces the action's own error as a model-fixable failure", async () => {
    getLorebookEntryMock.mockImplementation(async () => EXISTING)
    updateLorebookEntryMock.mockImplementation(async () => ({
      ok: false,
      error: "Name is required.",
    }))
    const result = await handler()({ storyId: "s1", id: "lore-1", name: "  " })
    // name trims to blank before hitting the action, so this should fail
    // locally with the same message class, not reach updateLorebookEntry.
    expect(result.isError).toBe(true)
  })
})
