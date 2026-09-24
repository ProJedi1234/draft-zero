// lib/mcp/tools/story-crud.test.ts — handler shaping logic against mocked
// queries and the real stories service over a scripted drizzle chain. No live
// DB, no HTTP.
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"

import { installQueryMocks, stubQueries } from "@/lib/mcp/tools/test-queries"
import { captureBus, installFakeDb } from "@/lib/services/test-support"

/* -------------------------------------------------------------------------- */
/* Mocks — declared before importing the module under test                   */
/* -------------------------------------------------------------------------- */

/** A stories row as the service's insert or update returns it. */
const STORY_ROW = {
  id: "story-1",
  title: "Doomed Story",
  description: "",
  genre: "",
  createdAt: "2026-08-28T00:00:00.000Z",
  updatedAt: "2026-08-28T00:00:01.000Z",
  tintHue: null,
  tintStrength: 1,
  tintAuto: true,
}

// recordFor's word-count read, which follows every story write.
const listStoryRecordsMock = mock(async (options: { storyId?: string }) => [
  { id: options.storyId, version: "v", row: { wordCount: 0 } },
])

// The two reads behind delete_story's confirmation question. getStoryTitle
// doubles as the existence check, so `null` is how a missing story reaches
// the handler.
const getStoryTitleMock = mock(
  async (_id: string) => "Doomed Story" as string | null
)
const countLivePassagesMock = mock(async (_id: string) => 0)

installQueryMocks()
const db = installFakeDb()

const {
  registerCreateStory,
  registerDeleteStory,
  registerDuplicateStory,
  registerUpdateStory,
} = await import("@/lib/mcp/tools/story-crud")

/* -------------------------------------------------------------------------- */
/* Harness — a fake McpServer that just records registered handlers          */
/* -------------------------------------------------------------------------- */

type ToolHandler = (args: unknown, ctx: unknown) => Promise<unknown>

function makeFakeServer() {
  const handlers = new Map<string, ToolHandler>()
  const server = {
    registerTool: (name: string, _config: unknown, handler: ToolHandler) => {
      handlers.set(name, handler)
    },
  }
  return { server, handlers }
}

function makeCtx(
  overrides: {
    requestState?: unknown
    inputResponses?: Record<string, unknown>
  } = {}
) {
  return {
    mcpReq: {
      requestState: () => overrides.requestState,
      inputResponses: overrides.inputResponses,
    },
  }
}

/** The root of every statement the service ran, in order. */
function roots() {
  return db.statements.map((statement) => statement.root)
}

/** An update's column values, minus the server-minted version. */
function updateSet(index: number) {
  const set = db.argsOf(index, "set")?.[0] as Record<string, unknown>
  const { updatedAt: _version, ...columns } = set
  return columns
}

/** Whether statement `index`'s WHERE binds `value` anywhere in its SQL tree. */
function whereNames(index: number, value: string): boolean {
  const seen = new Set<unknown>()
  const walk = (node: unknown): boolean => {
    if (node === value) return true
    if (typeof node !== "object" || node === null || seen.has(node)) {
      return false
    }
    seen.add(node)
    return Object.values(node).some(walk)
  }
  return walk(db.argsOf(index, "where"))
}

let bus: Awaited<ReturnType<typeof captureBus>>

beforeEach(async () => {
  stubQueries({
    getStoryTitle: getStoryTitleMock,
    countLivePassages: countLivePassagesMock,
    getAppSettings: async () => ({ defaultProfileId: null }),
    listStoryRecords: listStoryRecordsMock,
  })
  db.reset()
  bus = await captureBus()
  listStoryRecordsMock.mockClear()
  getStoryTitleMock.mockClear()
  countLivePassagesMock.mockClear()
  getStoryTitleMock.mockImplementation(async () => "Doomed Story")
  countLivePassagesMock.mockImplementation(async () => 0)
})

afterEach(() => bus.stop())

/* -------------------------------------------------------------------------- */
/* create_story                                                              */
/* -------------------------------------------------------------------------- */

describe("create_story", () => {
  test("creates with only a title, no metadata patch", async () => {
    const { server, handlers } = makeFakeServer()
    registerCreateStory(server as never, undefined as never)
    const handler = handlers.get("create_story")!

    db.next([{ ...STORY_ROW, title: "The Long Road" }])
    const result = (await handler({ title: "The Long Road" }, makeCtx())) as {
      isError?: boolean
      structuredContent: { id: string; title: string }
    }

    expect(roots()).toEqual(["insert"])
    const inserted = db.argsOf(0, "values")?.[0] as Record<string, unknown>
    expect(inserted.title).toBe("The Long Road")
    expect(result.structuredContent).toEqual({
      id: inserted.id as string,
      title: "The Long Road",
    })
    expect(result.isError).toBeUndefined()
    // MCP has no sync channel of its own, so every device hears the create.
    expect(bus.events[0]).toMatchObject({ op: "upsert", origin: null })
  })

  test("patches metadata in a follow-up call when extra fields are given", async () => {
    const { server, handlers } = makeFakeServer()
    registerCreateStory(server as never, undefined as never)
    const handler = handlers.get("create_story")!

    db.next([STORY_ROW])
    db.next([STORY_ROW])
    await handler(
      { title: "The Long Road", genre: "western", memory: "Dust everywhere." },
      makeCtx()
    )

    expect(roots()).toEqual(["insert", "update"])
    const createdId = (db.argsOf(0, "values")?.[0] as { id: string }).id
    expect(whereNames(1, createdId)).toBe(true)
    expect(updateSet(1)).toEqual({
      genre: "western",
      memory: "Dust everywhere.",
    })
  })

  test("creates a fully configured story in one call", async () => {
    // The parity this pins: create and update take the same metadata. Before,
    // authorsNote was update-only and systemPrompt create-only, so standing a
    // story up cost a second call and the system prompt was write-once.
    const { server, handlers } = makeFakeServer()
    registerCreateStory(server as never, undefined as never)
    const handler = handlers.get("create_story")!

    db.next([STORY_ROW])
    db.next([STORY_ROW])
    await handler(
      {
        title: "The Long Road",
        description: "A western.",
        genre: "western",
        memory: "Dust everywhere.",
        authorsNote: "Keep it terse.",
        systemPrompt: "You are a laconic narrator.",
      },
      makeCtx()
    )

    expect(updateSet(1)).toEqual({
      description: "A western.",
      genre: "western",
      memory: "Dust everywhere.",
      authorsNote: "Keep it terse.",
      systemPrompt: "You are a laconic narrator.",
    })
  })

  test("surfaces a failed create as a model-visible error, not a throw", async () => {
    // An insert that returns no row is the service's own failure path.
    db.next([])
    const { server, handlers } = makeFakeServer()
    registerCreateStory(server as never, undefined as never)
    const handler = handlers.get("create_story")!

    const result = (await handler({ title: "X" }, makeCtx())) as {
      isError?: boolean
      content: { text: string }[]
    }

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain("Story could not be created.")
  })
})

/* -------------------------------------------------------------------------- */
/* duplicate_story                                                           */
/* -------------------------------------------------------------------------- */

describe("duplicate_story", () => {
  function duplicateHandler() {
    const { server, handlers } = makeFakeServer()
    registerDuplicateStory(server as never, undefined as never)
    return handlers.get("duplicate_story")!
  }

  /** Scripts the service's reads and the copy insert, for an empty story. */
  function scriptEmptyCopy() {
    db.next([STORY_ROW])
    db.next([])
    db.next([])
    db.next([{ ...STORY_ROW, title: "Doomed Story (copy)" }])
  }

  /** The id the service minted for the copy. */
  function copyId() {
    return (db.argsOf(3, "values")?.[0] as { id: string }).id
  }

  test("copies under the service's default title", async () => {
    scriptEmptyCopy()
    const result = (await duplicateHandler()(
      { storyId: "story-1" },
      makeCtx()
    )) as {
      isError?: boolean
      structuredContent: { id: string; title: string; sourceId: string }
    }

    expect(roots()).toEqual(["select", "select", "select", "insert"])
    expect(result.isError).toBeUndefined()
    expect(copyId()).not.toBe("story-1")
    expect(result.structuredContent).toEqual({
      id: copyId(),
      title: "Doomed Story (copy)",
      sourceId: "story-1",
    })
    expect(bus.events[0]).toMatchObject({ op: "upsert", origin: null })
  })

  test("renames the copy, not the original, when a title is given", async () => {
    scriptEmptyCopy()
    db.next([{ ...STORY_ROW, title: "Road Not Taken" }])
    const result = (await duplicateHandler()(
      { storyId: "story-1", title: "Road Not Taken" },
      makeCtx()
    )) as { structuredContent: { id: string; title: string } }

    expect(roots()).toEqual(["select", "select", "select", "insert", "update"])
    expect(whereNames(4, copyId())).toBe(true)
    expect(whereNames(4, "story-1")).toBe(false)
    expect(updateSet(4)).toEqual({ title: "Road Not Taken" })
    expect(result.structuredContent.title).toBe("Road Not Taken")
  })

  test("an unknown story is a model-fixable failure", async () => {
    db.next([])
    const result = (await duplicateHandler()(
      { storyId: "missing" },
      makeCtx()
    )) as { isError?: boolean; content: { text: string }[] }

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toBe("Story not found.")
    expect(roots()).toEqual(["select"])
    expect(bus.events).toEqual([])
  })
})

/* -------------------------------------------------------------------------- */
/* update_story                                                              */
/* -------------------------------------------------------------------------- */

describe("update_story", () => {
  test("reports only the fields actually passed as changed", async () => {
    const { server, handlers } = makeFakeServer()
    registerUpdateStory(server as never, undefined as never)
    const handler = handlers.get("update_story")!

    db.next([STORY_ROW])
    const result = (await handler(
      { storyId: "story-1", title: "New Title", memory: "Updated memory." },
      makeCtx()
    )) as { structuredContent: { id: string; changed: string[] } }

    expect(roots()).toEqual(["update"])
    expect(whereNames(0, "story-1")).toBe(true)
    expect(updateSet(0)).toEqual({
      title: "New Title",
      memory: "Updated memory.",
    })
    expect(bus.events[0]).toMatchObject({ id: "story-1", origin: null })
    expect(result.structuredContent.changed.sort()).toEqual(
      ["memory", "title"].sort()
    )
  })

  test("update reaches the system prompt too", async () => {
    const { server, handlers } = makeFakeServer()
    registerUpdateStory(server as never, undefined as never)
    const handler = handlers.get("update_story")!

    db.next([STORY_ROW])
    const result = (await handler(
      { storyId: "story-1", systemPrompt: "You are a laconic narrator." },
      makeCtx()
    )) as { structuredContent: { id: string; changed: string[] } }

    expect(updateSet(0)).toEqual({
      systemPrompt: "You are a laconic narrator.",
    })
    expect(result.structuredContent.changed).toEqual(["systemPrompt"])
  })

  test("rejects a call with nothing to update, without touching the service", async () => {
    const { server, handlers } = makeFakeServer()
    registerUpdateStory(server as never, undefined as never)
    const handler = handlers.get("update_story")!

    const result = (await handler({ storyId: "story-1" }, makeCtx())) as {
      isError?: boolean
    }

    expect(result.isError).toBe(true)
    expect(db.statements).toEqual([])
  })

  test("surfaces the service's refusal as a model-fixable failure", async () => {
    const { server, handlers } = makeFakeServer()
    registerUpdateStory(server as never, undefined as never)
    const handler = handlers.get("update_story")!

    const blank = (await handler(
      { storyId: "story-1", title: "   " },
      makeCtx()
    )) as { isError?: boolean; content: { text: string }[] }
    expect(blank.isError).toBe(true)
    expect(blank.content[0].text).toBe("Title can't be empty.")

    db.next([])
    const missing = (await handler(
      { storyId: "story-1", genre: "noir" },
      makeCtx()
    )) as { isError?: boolean; content: { text: string }[] }
    expect(missing.content[0].text).toBe("Story not found.")
    expect(bus.events).toEqual([])
  })
})

/* -------------------------------------------------------------------------- */
/* delete_story — the MRTR flow                                              */
/* -------------------------------------------------------------------------- */

describe("delete_story", () => {
  const deps = {
    mintRequestState: mock(async (payload: unknown) => JSON.stringify(payload)),
  }

  beforeEach(() => {
    deps.mintRequestState.mockClear()
  })

  test("first call asks for confirmation and does not delete", async () => {
    countLivePassagesMock.mockImplementation(async () => 7)
    const { server, handlers } = makeFakeServer()
    registerDeleteStory(server as never, deps as never)
    const handler = handlers.get("delete_story")!

    const result = (await handler({ storyId: "story-1" }, makeCtx())) as {
      resultType?: string
      inputRequests?: { confirm: { params: { message: string } } }
    }

    expect(roots()).not.toContain("delete")
    expect(deps.mintRequestState).toHaveBeenCalledTimes(1)
    expect(deps.mintRequestState.mock.calls[0][0]).toMatchObject({
      tool: "delete_story",
      storyId: "story-1",
      title: "Doomed Story",
    })
    // inputRequired() builds an embedded elicitation; the confirmation text
    // must name the story and its passage count per the plan.
    const message = JSON.stringify(result)
    expect(message).toContain("Doomed Story")
    expect(message).toContain("7 passages")
  })

  test("unknown story id fails instead of asking to confirm", async () => {
    getStoryTitleMock.mockImplementation(async () => null)
    const { server, handlers } = makeFakeServer()
    registerDeleteStory(server as never, deps as never)
    const handler = handlers.get("delete_story")!

    const result = (await handler({ storyId: "missing" }, makeCtx())) as {
      isError?: boolean
      content: { text: string }[]
    }

    expect(result.isError).toBe(true)
    expect(roots()).not.toContain("delete")
  })

  test("confirmed retry deletes and reports the delta", async () => {
    const { server, handlers } = makeFakeServer()
    registerDeleteStory(server as never, deps as never)
    const handler = handlers.get("delete_story")!

    db.next([{ id: "story-1" }])
    const result = (await handler(
      { storyId: "story-1" },
      makeCtx({
        requestState: {
          tool: "delete_story",
          storyId: "story-1",
          title: "Doomed Story",
        },
        inputResponses: {
          confirm: { action: "accept", content: { confirm: true } },
        },
      })
    )) as { structuredContent: { id: string; title: string; deleted: boolean } }

    expect(roots()).toEqual(["delete"])
    expect(whereNames(0, "story-1")).toBe(true)
    expect(bus.events[0]).toMatchObject({
      op: "delete",
      entity: "story",
      id: "story-1",
      origin: null,
    })
    expect(result.structuredContent).toEqual({
      id: "story-1",
      title: "Doomed Story",
      deleted: true,
    })
  })

  test.each([["decline"], ["cancel"]])(
    "a %s ends the call instead of asking again",
    async (action) => {
      // The bug this pins: acceptedContent reports decline, cancel and
      // "not asked yet" all as undefined, so a "no" that falls through to
      // round 1 re-issues the same destructive prompt on every refusal.
      const { server, handlers } = makeFakeServer()
      registerDeleteStory(server as never, deps as never)
      const handler = handlers.get("delete_story")!

      const result = (await handler(
        { storyId: "story-1" },
        makeCtx({
          requestState: {
            tool: "delete_story",
            storyId: "story-1",
            title: "Doomed Story",
          },
          inputResponses: { confirm: { action } },
        })
      )) as {
        structuredContent?: { id: string; title: string; deleted: boolean }
        inputRequests?: unknown
      }

      expect(roots()).not.toContain("delete")
      expect(result.inputRequests).toBeUndefined()
      expect(result.structuredContent).toEqual({
        id: "story-1",
        title: "Doomed Story",
        deleted: false,
      })
    }
  )

  test("answering the confirmation with false leaves the story untouched", async () => {
    const { server, handlers } = makeFakeServer()
    registerDeleteStory(server as never, deps as never)
    const handler = handlers.get("delete_story")!

    const result = (await handler(
      { storyId: "story-1" },
      makeCtx({
        requestState: {
          tool: "delete_story",
          storyId: "story-1",
          title: "Doomed Story",
        },
        inputResponses: {
          confirm: { action: "accept", content: { confirm: false } },
        },
      })
    )) as { structuredContent: { id: string; title: string; deleted: boolean } }

    expect(roots()).not.toContain("delete")
    expect(result.structuredContent.deleted).toBe(false)
  })

  test("a seal for a different story is not trusted, even with an answer", async () => {
    const { server, handlers } = makeFakeServer()
    registerDeleteStory(server as never, deps as never)
    const handler = handlers.get("delete_story")!

    const result = (await handler(
      { storyId: "story-2" },
      makeCtx({
        requestState: {
          tool: "delete_story",
          storyId: "story-1",
          title: "Doomed Story",
        },
        inputResponses: {
          confirm: { action: "accept", content: { confirm: true } },
        },
      })
    )) as { structuredContent?: unknown }

    // The writer confirmed story-1; nothing may be deleted on a retry that
    // swapped the argument. Falls back to round 1 and asks about story-2.
    expect(roots()).not.toContain("delete")
    expect(result.structuredContent).toBeUndefined()
    expect(deps.mintRequestState.mock.calls[0][0]).toMatchObject({
      storyId: "story-2",
    })
  })

  test("a seal minted for another tool is not trusted, even with an answer", async () => {
    const { server, handlers } = makeFakeServer()
    registerDeleteStory(server as never, deps as never)
    const handler = handlers.get("delete_story")!

    await handler(
      { storyId: "story-1" },
      makeCtx({
        requestState: { tool: "update_story", storyId: "story-1" },
        inputResponses: {
          confirm: { action: "accept", content: { confirm: true } },
        },
      })
    )

    // Falls back to round 1 (asks again) instead of deleting on a foreign seal.
    expect(roots()).not.toContain("delete")
  })
})
