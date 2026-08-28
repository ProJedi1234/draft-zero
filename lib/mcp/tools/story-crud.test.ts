// lib/mcp/tools/story-crud.test.ts — handler shaping logic against mocked
// queries and mocked lib/actions/stories. No live DB, no HTTP.
import { beforeEach, describe, expect, mock, test } from "bun:test"

import { installQueryMocks, stubQueries } from "@/lib/mcp/tools/test-queries"

/* -------------------------------------------------------------------------- */
/* Mocks — declared before importing the module under test                   */
/* -------------------------------------------------------------------------- */

const createStoryMock = mock(
  async (_input?: {
    title?: string
  }): Promise<
    { ok: true; data: { id: string } } | { ok: false; error: string }
  > => ({
    ok: true,
    data: { id: "story-1" },
  })
)
const updateStoryMetaMock = mock(async (_id: string, _patch: unknown) => ({
  ok: true as const,
  data: null,
}))
const deleteStoryMock = mock(async (_id: string) => ({
  ok: true as const,
  data: null,
}))

mock.module("@/lib/actions/stories", () => ({
  createStory: createStoryMock,
  updateStoryMeta: updateStoryMetaMock,
  deleteStory: deleteStoryMock,
}))

// The two reads behind delete_story's confirmation question. getStoryTitle
// doubles as the existence check, so `null` is how a missing story reaches
// the handler.
const getStoryTitleMock = mock(
  async (_id: string) => "Doomed Story" as string | null
)
const countLivePassagesMock = mock(async (_id: string) => 0)

installQueryMocks()

const { registerCreateStory, registerDeleteStory, registerUpdateStory } =
  await import("@/lib/mcp/tools/story-crud")

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

beforeEach(() => {
  stubQueries({
    getStoryTitle: getStoryTitleMock,
    countLivePassages: countLivePassagesMock,
  })
  createStoryMock.mockClear()
  updateStoryMetaMock.mockClear()
  deleteStoryMock.mockClear()
  getStoryTitleMock.mockClear()
  countLivePassagesMock.mockClear()
  getStoryTitleMock.mockImplementation(async () => "Doomed Story")
  countLivePassagesMock.mockImplementation(async () => 0)
})

/* -------------------------------------------------------------------------- */
/* create_story                                                              */
/* -------------------------------------------------------------------------- */

describe("create_story", () => {
  test("creates with only a title, no metadata patch", async () => {
    const { server, handlers } = makeFakeServer()
    registerCreateStory(server as never, undefined as never)
    const handler = handlers.get("create_story")!

    const result: never = (await handler(
      { title: "The Long Road" },
      makeCtx()
    )) as never

    expect(createStoryMock).toHaveBeenCalledTimes(1)
    expect(updateStoryMetaMock).not.toHaveBeenCalled()
    expect(
      (result as { structuredContent: unknown }).structuredContent
    ).toEqual({
      id: "story-1",
      title: "The Long Road",
    })
    expect((result as { isError?: boolean }).isError).toBeUndefined()
  })

  test("patches metadata in a follow-up call when extra fields are given", async () => {
    const { server, handlers } = makeFakeServer()
    registerCreateStory(server as never, undefined as never)
    const handler = handlers.get("create_story")!

    await handler(
      { title: "The Long Road", genre: "western", memory: "Dust everywhere." },
      makeCtx()
    )

    expect(updateStoryMetaMock).toHaveBeenCalledTimes(1)
    expect(updateStoryMetaMock.mock.calls[0][0]).toBe("story-1")
    expect(updateStoryMetaMock.mock.calls[0][1]).toEqual({
      genre: "western",
      memory: "Dust everywhere.",
    })
  })

  test("surfaces a failed create as a model-visible error, not a throw", async () => {
    createStoryMock.mockImplementationOnce(async () => ({
      ok: false as const,
      error: "boom",
    }))
    const { server, handlers } = makeFakeServer()
    registerCreateStory(server as never, undefined as never)
    const handler = handlers.get("create_story")!

    const result = (await handler({ title: "X" }, makeCtx())) as {
      isError?: boolean
      content: { text: string }[]
    }

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain("boom")
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

    const result = (await handler(
      { storyId: "story-1", title: "New Title", memory: "Updated memory." },
      makeCtx()
    )) as { structuredContent: { id: string; changed: string[] } }

    expect(updateStoryMetaMock).toHaveBeenCalledWith("story-1", {
      title: "New Title",
      memory: "Updated memory.",
    })
    expect(result.structuredContent.changed.sort()).toEqual(
      ["memory", "title"].sort()
    )
  })

  test("rejects a call with nothing to update, without touching the action", async () => {
    const { server, handlers } = makeFakeServer()
    registerUpdateStory(server as never, undefined as never)
    const handler = handlers.get("update_story")!

    const result = (await handler({ storyId: "story-1" }, makeCtx())) as {
      isError?: boolean
    }

    expect(result.isError).toBe(true)
    expect(updateStoryMetaMock).not.toHaveBeenCalled()
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

    expect(deleteStoryMock).not.toHaveBeenCalled()
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
    expect(deleteStoryMock).not.toHaveBeenCalled()
  })

  test("confirmed retry deletes and reports the delta", async () => {
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
          confirm: { action: "accept", content: { confirm: true } },
        },
      })
    )) as { structuredContent: { id: string; title: string; deleted: boolean } }

    expect(deleteStoryMock).toHaveBeenCalledWith("story-1")
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

      expect(deleteStoryMock).not.toHaveBeenCalled()
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

    expect(deleteStoryMock).not.toHaveBeenCalled()
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
    expect(deleteStoryMock).not.toHaveBeenCalled()
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
    expect(deleteStoryMock).not.toHaveBeenCalled()
  })
})
