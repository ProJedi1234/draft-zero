// lib/mcp/tools/lore.test.ts — handler shaping logic against mocked queries
// and the real lorebook service over a scripted drizzle chain. No live DB.
import { beforeEach, describe, expect, mock, test } from "bun:test"
import { z } from "zod"

import { installQueryMocks, stubQueries } from "@/lib/mcp/tools/test-queries"
import { installFakeDb } from "@/lib/services/test-support"

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

const getStoryTitleMock = mock(
  async (_storyId: string) => "Some Story" as string | null
)

const db = installFakeDb()

/** A lorebook_entries row as the service's insert/update would return it. */
function rowOf(entry: FakeEntry) {
  const { keys, ...rest } = entry
  return { ...rest, keysJson: JSON.stringify(keys) }
}

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
  const configs = new Map<string, { inputSchema: z.ZodTypeAny }>()
  const server = {
    registerTool: (
      name: string,
      config: { inputSchema: z.ZodTypeAny },
      handler: ToolHandler
    ) => {
      handlers.set(name, handler)
      configs.set(name, config)
    },
  }
  return { server, handlers, configs }
}

beforeEach(() => {
  stubQueries({
    getLorebookEntry: getLorebookEntryMock,
    getStoryTitle: getStoryTitleMock,
    listLorebookEntries: listLorebookEntriesMock,
  })
  getStoryTitleMock.mockClear()
  getStoryTitleMock.mockImplementation(async () => "Some Story")
  getLorebookEntryMock.mockClear()
  listLorebookEntriesMock.mockClear()
  db.reset()
  getLorebookEntryMock.mockImplementation(async () => null)
  listLorebookEntriesMock.mockImplementation(async () => [])
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
    db.next([rowOf({ ...EXISTING, id: "lore-new" })])
    const result = await handler()({
      storyId: "s1",
      name: "Vell",
      category: "character",
      keys: ["vell"],
      content: "A wanderer.",
    })
    expect(result.isError).toBeUndefined()
    expect(db.statements.map((statement) => statement.root)).toEqual(["insert"])
    expect(db.argsOf(0, "values")?.[0]).toMatchObject({ storyId: "s1" })
    expect(result.structuredContent).toMatchObject({
      id: "lore-new",
      name: "Vell",
      created: true,
    })
  })

  test("create reports the fields the caller set, not every field", async () => {
    // Everything "changed" on a create by definition, so echoing the defaulted
    // fields back says nothing about what the model actually chose.
    db.next([rowOf({ ...EXISTING, id: "lore-new" })])
    const result = await handler()({
      storyId: "s1",
      name: "Vell",
      keys: ["vell"],
      content: "A wanderer.",
    })

    expect(result.structuredContent?.changed).toEqual([
      "name",
      "keys",
      "content",
    ])
  })

  test("creating against an unknown story fails correctably, not opaquely", async () => {
    // story_id is a foreign key: without this check the insert dies in
    // Postgres and the model gets runTool's blanket "the server logged the
    // reason" line, with no way to tell a typo from a server defect.
    getStoryTitleMock.mockImplementation(async () => null)

    const result = await handler()({
      storyId: "s-typo",
      name: "Vell",
      content: "A wanderer.",
    })

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("No story with id s-typo")
    expect(db.statements).toEqual([])
  })

  test("reads back an entry whose stored category predates the enum", async () => {
    // Rows written before lore_write validated categories can hold anything.
    // Validating reads against the closed set would make that data
    // unreadable — a lore entry nobody can open, created by our own tool.
    getLorebookEntryMock.mockImplementation(async () => ({
      ...EXISTING,
      id: "lore-old",
      name: "Lara Croft",
      category: "Character",
      content: "A raider of tombs.",
    }))
    const { server, handlers } = makeFakeServer()
    registerLoreGet(server as never, {} as never)
    const result = await handlers.get("lore_get")!({
      storyId: "s1",
      id: "lore-old",
    })

    expect(result.isError).toBeUndefined()
    expect(result.structuredContent).toMatchObject({
      name: "Lara Croft",
      category: "Character",
      content: "A raider of tombs.",
    })
  })

  test("rejects a category outside the closed set", async () => {
    // The column is plain text with no CHECK constraint, so an off-union
    // value persists and then matches no chip in the lorebook UI. The schema
    // is the only thing standing between the model and that row.
    const { server, configs } = makeFakeServer()
    registerLoreWrite(server as never, {} as never)
    const schema = configs.get("lore_write")?.inputSchema
    if (!schema) throw new Error("lore_write did not register")

    expect(
      schema.safeParse({ storyId: "s1", name: "Kessa", category: "npc" })
        .success
    ).toBe(false)
    expect(
      schema.safeParse({ storyId: "s1", name: "Kessa", category: "character" })
        .success
    ).toBe(true)
  })

  test("creating without a name fails before touching the db", async () => {
    const result = await handler()({ storyId: "s1" })
    expect(result.isError).toBe(true)
    expect(db.statements).toEqual([])
  })

  test("updates only the fields that were actually passed and differ", async () => {
    getLorebookEntryMock.mockImplementation(async () => EXISTING)
    db.next([rowOf(EXISTING)])
    const result = await handler()({
      storyId: "s1",
      id: "lore-1",
      content: "A wandering swordswoman with a grudge.",
      priority: 50, // unchanged — must not appear in `changed`
    })
    expect(result.isError).toBeUndefined()
    expect(db.statements.map((statement) => statement.root)).toEqual(["update"])
    expect(db.argsOf(0, "set")?.[0]).toEqual({
      content: "A wandering swordswoman with a grudge.",
      updatedAt: expect.any(String),
    })
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
    expect(db.statements).toEqual([])
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
    expect(db.statements).toEqual([])
  })

  test("a blank name fails locally, before the service writes", async () => {
    getLorebookEntryMock.mockImplementation(async () => EXISTING)
    const result = await handler()({ storyId: "s1", id: "lore-1", name: "  " })
    expect(result.isError).toBe(true)
    expect(db.statements).toEqual([])
  })

  test("surfaces the service's own error as a model-fixable failure", async () => {
    // The entry vanished between the tool's read and the service's write.
    getLorebookEntryMock.mockImplementation(async () => EXISTING)
    db.next([])
    const result = await handler()({
      storyId: "s1",
      id: "lore-1",
      content: "x",
    })
    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toBe("Lorebook entry not found.")
  })
})
