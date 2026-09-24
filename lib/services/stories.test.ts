// lib/services/stories.test.ts — the stories service against a scripted
// drizzle chain, the doubled read module and the real sync bus. No live DB.
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"

import { installQueryMocks, stubQueries } from "@/lib/mcp/tools/test-queries"
import {
  storyCreatedOutput,
  storyPageOutput,
  storyWriteOutput,
} from "@/lib/services/stories.schema"
import { captureBus, installFakeDb } from "@/lib/services/test-support"

installQueryMocks()
const db = installFakeDb()
const stories = await import("@/lib/services/stories")

const STORY = "11111111-1111-4111-8111-111111111111"
const COPY = "33333333-3333-4333-8333-333333333333"
const CTX = { origin: "device-a" }
const UPDATED_AT = "2026-09-23T00:00:01.000Z"

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: STORY,
    title: "The Long Road",
    description: "",
    genre: "",
    memory: "",
    authorsNote: "",
    systemPrompt: null,
    profileId: "profile-1",
    modelId: "model-x",
    thinking: "off",
    providerTag: null,
    temperature: 1,
    topP: 1,
    contextWindow: 8192,
    frequencyPenalty: 0,
    presencePenalty: 0,
    tintHue: null,
    tintStrength: 1,
    tintAuto: true,
    undoCursor: 4,
    createdAt: "2026-09-23T00:00:00.000Z",
    updatedAt: UPDATED_AT,
    ...overrides,
  }
}

/** What recordFor projects from row() with the word count below. */
function record(overrides: Record<string, unknown> = {}) {
  const base = row(overrides)
  return {
    id: base.id,
    title: base.title,
    description: base.description,
    genre: base.genre,
    createdAt: base.createdAt,
    updatedAt: base.updatedAt,
    wordCount: 42,
    tintHue: base.tintHue,
    tintStrength: base.tintStrength,
    tintAuto: base.tintAuto,
  }
}

const listStoryRecords = mock(async (options: { storyId?: string }) => [
  {
    id: options.storyId,
    version: UPDATED_AT,
    row: record({ id: options.storyId }),
  },
])
const listStories = mock(async (_options: unknown) => ({
  stories: [],
  hasMore: false,
}))

/** A statement that rejects the way pg reports a primary-key collision. */
function uniqueViolation() {
  const error = Object.assign(new Error("duplicate key"), {
    cause: { code: "23505" },
  })
  return {
    then: (_resolve: unknown, reject: (e: unknown) => void) => reject(error),
  }
}

function upsertEvents(id: string, changeScope: string | null) {
  return [
    expect.objectContaining({
      kind: "entity",
      op: "upsert",
      entity: "story",
      id,
      storyId: id,
      version: UPDATED_AT,
      origin: "device-a",
    }),
    { kind: "change", storyId: changeScope, covered: true },
  ]
}

let bus: Awaited<ReturnType<typeof captureBus>>

beforeEach(async () => {
  stubQueries({
    getAppSettings: async () => ({ defaultProfileId: "profile-1" }),
    listStoryRecords,
    listStories,
  })
  listStoryRecords.mockClear()
  listStories.mockClear()
  db.reset()
  bus = await captureBus()
})

afterEach(() => bus.stop())

describe("loadStoryPage", () => {
  test("reads one page, publishing nothing", async () => {
    listStories.mockImplementationOnce(async () => ({
      stories: [],
      hasMore: true,
    }))
    const result = await stories.loadStoryPage({ offset: 20, query: "road" })
    expect(result.ok && storyPageOutput.parse(result.data).hasMore).toBe(true)
    // The query double replaces STORY_PAGE_SIZE too, so `limit` is not pinned.
    expect(listStories.mock.calls[0]?.[0]).toMatchObject({
      offset: 20,
      query: "road",
    })
    expect(bus.events).toEqual([])
  })

  test("a negative or fractional offset is invalid", async () => {
    for (const offset of [-1, 1.5, Number.NaN]) {
      const result = await stories.loadStoryPage({ offset })
      expect(result).toEqual({
        ok: false,
        code: "invalid",
        error: "Invalid offset.",
      })
    }
    expect(listStories).not.toHaveBeenCalled()
  })
})

describe("createStory", () => {
  test("inserts defaults under the default profile and publishes library-wide", async () => {
    db.next([row({ title: "Untitled Story" })])
    const result = await stories.createStory({ id: STORY, title: "  " }, CTX)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(storyCreatedOutput.parse(result.data).id).toBe(STORY)
    expect(result.data.record.wordCount).toBe(42)
    expect(db.argsOf(0, "values")?.[0]).toMatchObject({
      id: STORY,
      title: "Untitled Story",
      systemPrompt: null,
      profileId: "profile-1",
      providerTag: null,
    })
    expect(db.revalidated).toEqual(["/"])
    // Null scope: devices on no story must hear a new one arrive.
    expect(bus.events).toEqual(upsertEvents(STORY, null))
  })

  test("a retried id confirms the row the first attempt wrote, silently", async () => {
    db.next(uniqueViolation())
    const result = await stories.createStory({ id: STORY }, CTX)
    expect(result).toEqual({
      ok: true,
      data: { id: STORY, record: record() },
    })
    expect(bus.events).toEqual([])
    expect(db.revalidated).toEqual([])
  })

  test("a collision on a server-minted id is rethrown", async () => {
    db.next(uniqueViolation())
    await expect(stories.createStory({}, CTX)).rejects.toThrow("duplicate key")
  })

  test("an empty insert result fails", async () => {
    db.next([])
    const result = await stories.createStory({}, CTX)
    expect(result).toEqual({
      ok: false,
      code: "failed",
      error: "Story could not be created.",
    })
    expect(bus.events).toEqual([])
  })

  test("a malformed client id is refused before any read", async () => {
    const result = await stories.createStory({ id: "no/slashes" }, CTX)
    expect(result).toEqual({
      ok: false,
      code: "invalid",
      error: "Invalid story id.",
    })
    expect(db.statements).toEqual([])
  })
})

describe("updateStoryMeta", () => {
  test("writes only the given fields, trimmed title, blank prompt as null", async () => {
    db.next([row({ title: "New" })])
    const result = await stories.updateStoryMeta(
      {
        id: STORY,
        patch: { title: "  New  ", systemPrompt: "   ", summarize: false },
      },
      CTX
    )
    expect(result.ok && storyWriteOutput.parse(result.data).record.title).toBe(
      "New"
    )
    const set = db.argsOf(0, "set")?.[0] as Record<string, unknown>
    expect(Object.keys(set).sort()).toEqual([
      "summarize",
      "systemPrompt",
      "title",
      "updatedAt",
    ])
    expect(set).toMatchObject({
      title: "New",
      systemPrompt: null,
      summarize: false,
    })
    expect(bus.events).toEqual(upsertEvents(STORY, STORY))
  })

  test("a non-blank system prompt is stored as given, untrimmed", async () => {
    db.next([row()])
    await stories.updateStoryMeta(
      { id: STORY, patch: { systemPrompt: " Be terse. " } },
      CTX
    )
    expect(db.argsOf(0, "set")?.[0]).toMatchObject({
      systemPrompt: " Be terse. ",
    })
  })

  test("a blank title is refused before the write", async () => {
    const result = await stories.updateStoryMeta(
      { id: STORY, patch: { title: "   " } },
      CTX
    )
    expect(result).toEqual({
      ok: false,
      code: "invalid",
      error: "Title can't be empty.",
    })
    expect(db.statements).toEqual([])
  })

  test("a missing story is not_found and publishes nothing", async () => {
    db.next([])
    const result = await stories.updateStoryMeta(
      { id: STORY, patch: { genre: "noir" } },
      CTX
    )
    expect(result).toEqual({
      ok: false,
      code: "not_found",
      error: "Story not found.",
    })
    expect(bus.events).toEqual([])
    expect(db.revalidated).toEqual([])
  })
})

describe("updateStoryTint", () => {
  test("wraps the hue, clamps the strength and sets the flag", async () => {
    db.next([row({ tintHue: 40 })])
    const result = await stories.updateStoryTint(
      { id: STORY, patch: { hue: 400.4, strength: 3, auto: false } },
      CTX
    )
    expect(result.ok).toBe(true)
    expect(db.argsOf(0, "set")?.[0]).toMatchObject({
      tintHue: 40,
      tintStrength: 1,
      tintAuto: false,
    })
    expect(bus.events).toEqual(upsertEvents(STORY, STORY))
  })

  test("a null or non-finite hue clears; omitted strength and auto stay put", async () => {
    for (const hue of [null, Number.NaN]) {
      db.reset()
      db.next([row()])
      await stories.updateStoryTint({ id: STORY, patch: { hue } }, CTX)
      const set = db.argsOf(0, "set")?.[0] as Record<string, unknown>
      expect(set.tintHue).toBeNull()
      expect(Object.keys(set).sort()).toEqual(["tintHue", "updatedAt"])
    }
  })

  test("a hue that is not a number is invalid", async () => {
    const result = await stories.updateStoryTint(
      { id: STORY, patch: { hue: "red" as never } },
      CTX
    )
    expect(result).toEqual({
      ok: false,
      code: "invalid",
      error: "Invalid tint hue.",
    })
    expect(db.statements).toEqual([])
  })

  test("a missing story is not_found", async () => {
    db.next([])
    const result = await stories.updateStoryTint(
      { id: STORY, patch: { hue: 10 } },
      CTX
    )
    expect(result.ok || result.code).toBe("not_found")
    expect(bus.events).toEqual([])
  })
})

describe("setStoryTintAuto", () => {
  test("writes only the flag and the version", async () => {
    db.next([row({ tintAuto: false })])
    const result = await stories.setStoryTintAuto(
      { id: STORY, auto: false },
      CTX
    )
    expect(result.ok && result.data.record.tintAuto).toBe(false)
    const set = db.argsOf(0, "set")?.[0] as Record<string, unknown>
    expect(Object.keys(set).sort()).toEqual(["tintAuto", "updatedAt"])
    expect(bus.events).toEqual(upsertEvents(STORY, STORY))
  })

  test("a non-boolean is invalid", async () => {
    const result = await stories.setStoryTintAuto(
      { id: STORY, auto: "yes" as never },
      CTX
    )
    expect(result.ok || result.code).toBe("invalid")
    expect(db.statements).toEqual([])
  })

  test("a missing story is not_found", async () => {
    db.next([])
    const result = await stories.setStoryTintAuto(
      { id: STORY, auto: true },
      CTX
    )
    expect(result.ok || result.code).toBe("not_found")
  })
})

describe("duplicateStory", () => {
  const entry = {
    id: "e1",
    storyId: STORY,
    position: 3,
    variantGroupId: "g1",
    variantIndex: 2,
    isActive: true,
    source: "user",
    text: "I open the door.",
    actionKind: "do",
    inputText: "open the door",
  }
  const lore = { id: "l1", storyId: STORY, name: "Vell" }

  test("copies the live manuscript and lore under the copy id", async () => {
    db.next([row()])
    db.next([entry])
    db.next([lore])
    db.next([row({ id: COPY, title: "The Long Road (copy)" })])
    db.next([])
    db.next([])

    const result = await stories.duplicateStory(
      { id: STORY, copyId: COPY },
      CTX
    )
    expect(result.ok && result.data.id).toBe(COPY)
    expect(db.statements.map((s) => s.root)).toEqual([
      "select",
      "select",
      "select",
      "insert",
      "insert",
      "insert",
    ])
    expect(db.argsOf(3, "values")?.[0]).toMatchObject({
      id: COPY,
      title: "The Long Road (copy)",
      undoCursor: 0,
    })
    const [copied] = db.argsOf(4, "values")?.[0] as Record<string, unknown>[]
    expect(copied).toMatchObject({
      storyId: COPY,
      position: 0,
      variantIndex: 0,
      isActive: true,
      actionKind: "do",
      inputText: "open the door",
    })
    expect(copied.variantGroupId).toBe(copied.id)
    const [copiedLore] = db.argsOf(5, "values")?.[0] as Record<
      string,
      unknown
    >[]
    expect(copiedLore).toMatchObject({ storyId: COPY, name: "Vell" })
    expect(copiedLore.id).not.toBe("l1")
    expect(bus.events).toEqual(upsertEvents(COPY, null))
  })

  test("an empty story copies only its row", async () => {
    db.next([row()])
    db.next([])
    db.next([])
    db.next([row({ id: COPY })])
    await stories.duplicateStory({ id: STORY, copyId: COPY }, CTX)
    expect(db.statements.map((s) => s.root)).toEqual([
      "select",
      "select",
      "select",
      "insert",
    ])
  })

  test("a retried copy id confirms the first attempt, silently", async () => {
    db.next([row()])
    db.next([])
    db.next([])
    db.next(uniqueViolation())
    const result = await stories.duplicateStory(
      { id: STORY, copyId: COPY },
      CTX
    )
    expect(result).toEqual({
      ok: true,
      data: { id: COPY, record: record({ id: COPY }) },
    })
    expect(bus.events).toEqual([])
  })

  test("a malformed copy id is refused before the source is read", async () => {
    const result = await stories.duplicateStory(
      { id: STORY, copyId: "bad id" },
      CTX
    )
    expect(result).toEqual({
      ok: false,
      code: "invalid",
      error: "Invalid story id.",
    })
    expect(db.statements).toEqual([])
  })

  test("a missing source is not_found", async () => {
    db.next([])
    const result = await stories.duplicateStory({ id: STORY }, CTX)
    expect(result).toEqual({
      ok: false,
      code: "not_found",
      error: "Story not found.",
    })
    expect(db.statements).toHaveLength(1)
  })

  test("an empty copy insert fails", async () => {
    db.next([row()])
    db.next([])
    db.next([])
    db.next([])
    const result = await stories.duplicateStory({ id: STORY }, CTX)
    expect(result).toEqual({
      ok: false,
      code: "failed",
      error: "Story could not be copied.",
    })
  })
})

describe("deleteStory", () => {
  test("deletes and publishes a null-scoped removal", async () => {
    db.next([{ id: STORY }])
    const result = await stories.deleteStory({ id: STORY }, CTX)
    expect(result).toEqual({ ok: true, data: null })
    expect(db.revalidated).toEqual(["/"])
    expect(bus.events).toEqual([
      expect.objectContaining({
        kind: "entity",
        op: "delete",
        entity: "story",
        id: STORY,
        storyId: STORY,
        version: expect.any(String),
        origin: "device-a",
      }),
      { kind: "change", storyId: null, covered: true },
    ])
  })

  test("a story already gone succeeds without publishing", async () => {
    db.next([])
    const result = await stories.deleteStory({ id: STORY }, CTX)
    expect(result).toEqual({ ok: true, data: null })
    expect(bus.events).toEqual([])
  })

  test("a non-string id is invalid", async () => {
    const result = await stories.deleteStory({ id: 7 as never }, CTX)
    expect(result).toEqual({
      ok: false,
      code: "invalid",
      error: "Invalid story id.",
    })
  })
})

describe("updateGenerationSettings", () => {
  test("writes the given fields, clamps the lore budget", async () => {
    db.next([row()])
    const result = await stories.updateGenerationSettings(
      {
        id: STORY,
        patch: {
          providerTag: null,
          zdr: true,
          contextWindow: 8192,
          loreBudget: 99,
          thinking: "high",
        },
      },
      CTX
    )
    expect(result).toEqual({ ok: true, data: null })
    expect(db.argsOf(0, "set")?.[0]).toMatchObject({
      providerTag: null,
      zdr: true,
      contextWindow: 8192,
      loreBudget: 50,
      thinking: "high",
    })
    expect(bus.events).toEqual(upsertEvents(STORY, STORY))
  })

  test("a context window off the ladder is refused", async () => {
    const result = await stories.updateGenerationSettings(
      { id: STORY, patch: { contextWindow: 1000 } },
      CTX
    )
    expect(result).toEqual({
      ok: false,
      code: "invalid",
      error: "Unsupported context window.",
    })
    expect(db.statements).toEqual([])
  })

  test("a missing story is not_found", async () => {
    db.next([])
    const result = await stories.updateGenerationSettings(
      { id: STORY, patch: { temperature: 1 } },
      CTX
    )
    expect(result.ok || result.code).toBe("not_found")
    expect(bus.events).toEqual([])
  })
})

describe("setStoryImageModel", () => {
  test("writes the model, or null to follow the default", async () => {
    for (const imageModelId of ["img-model", null]) {
      db.reset()
      bus.events.length = 0
      db.next([row()])
      const result = await stories.setStoryImageModel(
        { id: STORY, imageModelId },
        CTX
      )
      expect(result).toEqual({ ok: true, data: null })
      expect(db.argsOf(0, "set")?.[0]).toMatchObject({ imageModelId })
      expect(bus.events).toEqual(upsertEvents(STORY, STORY))
    }
  })

  test("an omitted model is invalid rather than a silent no-op", async () => {
    const result = await stories.setStoryImageModel({ id: STORY } as never, CTX)
    expect(result).toEqual({
      ok: false,
      code: "invalid",
      error: "Invalid image model.",
    })
  })

  test("a missing story is not_found", async () => {
    db.next([])
    const result = await stories.setStoryImageModel(
      { id: STORY, imageModelId: null },
      CTX
    )
    expect(result.ok || result.code).toBe("not_found")
  })
})
