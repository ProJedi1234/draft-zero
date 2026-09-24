// lib/services/entries.test.ts — the entries service against a scripted
// drizzle chain, the real journal and the real sync bus. No live DB, no HTTP.
import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import { installQueryMocks, stubQueries } from "@/lib/mcp/tools/test-queries"
import { installEntriesDoubles } from "@/lib/services/entries-test-support"
import {
  appendEntryOutput,
  entryContextOutput,
  olderEntriesPageOutput,
} from "@/lib/services/entries.schema"
import { captureBus } from "@/lib/services/test-support"
import type { Story, StoryEntry } from "@/lib/types"

const db = await installEntriesDoubles()
installQueryMocks()
const entries = await import("@/lib/services/entries")
const { releaseRun, reserveRun } = await import("@/lib/generation/live")

// Its own id: specs share the process-global run registry, and a story another
// spec deleted is tombstoned there, so reserveRun would silently refuse it.
const STORY = "entries-service-spec-story"
const ENTRY = "22222222-2222-4222-8222-222222222222"
const CTX = { origin: "device-a" }
const RUNNING =
  "A generation is running for this story — wait for it to finish."

let bus: Awaited<ReturnType<typeof captureBus>>

beforeEach(async () => {
  db.reset()
  stubQueries({})
  bus = await captureBus()
})

afterEach(() => {
  bus.stop()
  releaseRun(STORY)
})

const roots = () => db.statements.map((s) => s.root)

/** A plain request-scoped commit: one revalidate and one unmarked change. */
function expectCommitted() {
  expect(db.revalidated).toEqual(["/"])
  expect(bus.events).toEqual([{ kind: "change", storyId: STORY }])
}

function expectNothingWritten() {
  expect(db.statements).toEqual([])
  expect(db.revalidated).toEqual([])
  expect(bus.events).toEqual([])
}

/** Scripts storyExists and both halves of nextStoryPosition for an append. */
function scriptAppend(position: number) {
  db.next([{ id: STORY }])
  db.next([{ max: position - 1 }])
  db.next([{ max: null }])
}

describe("appendActionEntry", () => {
  test("stores the translation beside the raw input, and does not commit", async () => {
    scriptAppend(7)
    const result = await entries.appendActionEntry(
      {
        storyId: STORY,
        kind: "do",
        rawText: "  open the door  ",
        turnId: "t1",
      },
      CTX
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const entry = appendEntryOutput.parse(result.data).entry
    expect(entry).toMatchObject({
      position: 7,
      source: "user",
      actionKind: "do",
      inputText: "open the door",
    })
    expect(entry.text).not.toBe("open the door")
    // storyExists, two position reads, the insert, then the journal and touch.
    expect(roots().slice(0, 4)).toEqual([
      "select",
      "select",
      "select",
      "insert",
    ])
    expect(db.argsOf(3, "values")?.[0]).toMatchObject({
      storyId: STORY,
      actionKind: "do",
      inputText: "open the door",
    })
    expect(db.revalidated).toEqual([])
    expect(bus.events).toEqual([])
  })

  test("rejects in the old action's order, with its sentences", async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [
        { storyId: "bad id", kind: "shout", rawText: "   " },
        "Nothing to add — write something first.",
      ],
      [
        { storyId: "bad id", kind: "shout", rawText: "hi" },
        "Unknown action kind.",
      ],
      [{ storyId: "bad id", kind: "say", rawText: "hi" }, "Invalid story id."],
    ]
    for (const [input, error] of cases) {
      const result = await entries.appendActionEntry(input as never, CTX)
      expect(result).toEqual({ ok: false, code: "invalid", error })
    }
    expectNothingWritten()
  })

  test("a missing story is not_found", async () => {
    db.next([])
    const result = await entries.appendActionEntry(
      { storyId: STORY, kind: "say", rawText: "hello" },
      CTX
    )
    expect(result).toEqual({
      ok: false,
      code: "not_found",
      error: "Story not found.",
    })
    expect(bus.events).toEqual([])
  })

  test("is not run-guarded: startGeneration appends inside its own run", async () => {
    expect(reserveRun(STORY)).toBe(true)
    scriptAppend(0)
    const result = await entries.appendActionEntry(
      { storyId: STORY, kind: "say", rawText: "hello" },
      CTX
    )
    expect(result.ok).toBe(true)
  })
})

describe("appendEntryOutsideRun", () => {
  test("narration is prose as-is, with no action columns", async () => {
    scriptAppend(3)
    const result = await entries.appendEntryOutsideRun(
      { storyId: STORY, mode: "narration", text: " The door creaks. " },
      CTX
    )
    expect(result.ok && result.data.entry).toMatchObject({
      position: 3,
      text: "The door creaks.",
      actionKind: null,
      inputText: null,
    })
    expect(db.revalidated).toEqual([])
    expect(bus.events).toEqual([])
  })

  test("do/say goes through the translation", async () => {
    scriptAppend(0)
    const result = await entries.appendEntryOutsideRun(
      { storyId: STORY, mode: "say", text: "hello" },
      CTX
    )
    expect(result.ok && result.data.entry).toMatchObject({
      actionKind: "say",
      inputText: "hello",
    })
  })

  test("blank narration is refused by the core's sentence", async () => {
    const result = await entries.appendEntryOutsideRun(
      { storyId: STORY, mode: "narration", text: "  " },
      CTX
    )
    expect(result).toEqual({
      ok: false,
      code: "invalid",
      error: "Nothing to add — write something first.",
    })
    expectNothingWritten()
  })

  test("rejects an unknown mode and a bad story id", async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ storyId: STORY, mode: "shout", text: "x" }, "Unknown action kind."],
      [
        { storyId: "bad id", mode: "narration", text: "x" },
        "Invalid story id.",
      ],
    ]
    for (const [input, error] of cases) {
      const result = await entries.appendEntryOutsideRun(input as never, CTX)
      expect(result).toEqual({ ok: false, code: "invalid", error })
    }
    expectNothingWritten()
  })

  test("refuses while a run holds the story, before anything else", async () => {
    expect(reserveRun(STORY)).toBe(true)
    const result = await entries.appendEntryOutsideRun(
      { storyId: STORY, mode: "shout" as never, text: "" },
      CTX
    )
    expect(result).toEqual({ ok: false, code: "conflict", error: RUNNING })
    expectNothingWritten()
  })
})

describe("updateActionEntry", () => {
  const input = {
    storyId: STORY,
    entryId: ENTRY,
    rawText: "  wave  ",
    kind: "do" as const,
  }

  test("rewrites both columns, journals the old prose, touches and commits", async () => {
    db.next([{ text: "You say hi.", actionKind: "say", inputText: "hi" }])
    db.next([{ id: ENTRY }])
    db.next([{ undoCursor: 2 }])
    const result = await entries.updateActionEntry(input, CTX)

    expect(result).toEqual({ ok: true, data: null })
    expect(roots()).toEqual([
      "select", // the prose before
      "update", // the passage
      "select", // journal cursor
      "delete", // redo tail
      "select", // edit coalescing
      "insert", // the op
      "update", // the cursor
      "update", // touchStoryRow
    ])
    const set = db.argsOf(1, "set")?.[0] as Record<string, unknown>
    expect(set).toMatchObject({ actionKind: "do", inputText: "wave" })
    const op = db.argsOf(5, "values")?.[0] as { payloadJson: string }
    expect(JSON.parse(op.payloadJson)).toMatchObject({
      kind: "edit",
      entryId: ENTRY,
      before: { text: "You say hi.", actionKind: "say", inputText: "hi" },
      after: { actionKind: "do", inputText: "wave" },
    })
    expectCommitted()
  })

  test("rejects in the old action's order, with its sentences", async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ ...input, kind: "shout", rawText: "" }, "Unknown action kind."],
      [{ ...input, rawText: "   " }, "A passage can't be empty."],
      [{ ...input, entryId: "bad id" }, "Invalid entry id."],
    ]
    for (const [raw, error] of cases) {
      const result = await entries.updateActionEntry(raw as never, CTX)
      expect(result).toEqual({ ok: false, code: "invalid", error })
    }
    expectNothingWritten()
  })

  test("a passage that is not a Say or Do is refused inside the transaction", async () => {
    db.next([{ text: "Prose.", actionKind: null, inputText: null }])
    const result = await entries.updateActionEntry(input, CTX)
    expect(result).toEqual({
      ok: false,
      code: "invalid",
      error: "This passage isn't a Say or Do.",
    })
    expect(roots()).toEqual(["select"])
    expect(bus.events).toEqual([])
  })

  test("a missing passage, or one deleted mid-edit, is not_found", async () => {
    const notFound = {
      ok: false,
      code: "not_found",
      error: "Passage not found.",
    } as const
    db.next([])
    expect(await entries.updateActionEntry(input, CTX)).toEqual(notFound)

    db.next([{ text: "You say hi.", actionKind: "say", inputText: "hi" }])
    db.next([])
    expect(await entries.updateActionEntry(input, CTX)).toEqual(notFound)
    expect(bus.events).toEqual([])
  })

  test("refuses while a run holds the story, before validating", async () => {
    expect(reserveRun(STORY)).toBe(true)
    const result = await entries.updateActionEntry(
      { ...input, kind: "shout" as never },
      CTX
    )
    expect(result).toEqual({ ok: false, code: "conflict", error: RUNNING })
    expectNothingWritten()
  })
})

describe("updateEntryText", () => {
  const input = { storyId: STORY, entryId: ENTRY, text: "  Rewritten.  " }

  test("writes trimmed prose, clears the action pair, journals and commits", async () => {
    db.next([{ text: "You wave.", actionKind: "do", inputText: "wave" }])
    db.next([{ id: ENTRY }])
    db.next([{ undoCursor: 0 }])
    const result = await entries.updateEntryText(input, CTX)

    expect(result).toEqual({ ok: true, data: null })
    expect(db.argsOf(1, "set")?.[0]).toEqual({
      text: "Rewritten.",
      actionKind: null,
      inputText: null,
    })
    const op = db.argsOf(5, "values")?.[0] as { payloadJson: string }
    expect(JSON.parse(op.payloadJson)).toMatchObject({
      kind: "edit",
      before: { text: "You wave.", actionKind: "do", inputText: "wave" },
      after: { text: "Rewritten.", actionKind: null, inputText: null },
    })
    expect(roots().at(-1)).toBe("update")
    expectCommitted()
  })

  test("rejects blank text and bad ids with the old sentences", async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [
        { ...input, storyId: "bad id", text: "  " },
        "A passage can't be empty.",
      ],
      [{ ...input, storyId: "bad id" }, "Invalid story id."],
    ]
    for (const [raw, error] of cases) {
      const result = await entries.updateEntryText(raw as never, CTX)
      expect(result).toEqual({ ok: false, code: "invalid", error })
    }
    expectNothingWritten()
  })

  test("a missing passage is not_found and publishes nothing", async () => {
    db.next([])
    expect(await entries.updateEntryText(input, CTX)).toEqual({
      ok: false,
      code: "not_found",
      error: "Passage not found.",
    })
    expect(db.revalidated).toEqual([])
    expect(bus.events).toEqual([])
  })

  test("refuses while a run holds the story", async () => {
    expect(reserveRun(STORY)).toBe(true)
    expect(await entries.updateEntryText(input, CTX)).toEqual({
      ok: false,
      code: "conflict",
      error: RUNNING,
    })
    expectNothingWritten()
  })
})

describe("deleteEntry", () => {
  const input = { storyId: STORY, entryId: ENTRY }

  test("soft-deletes, journals a delete op, touches and commits", async () => {
    db.next([{ id: ENTRY }])
    db.next([{ undoCursor: 4 }])
    const result = await entries.deleteEntry(input, CTX)

    expect(result).toEqual({ ok: true, data: null })
    expect(roots()).toEqual([
      "update",
      "select",
      "delete",
      "insert",
      "update",
      "update",
    ])
    expect(db.argsOf(0, "set")?.[0]).toEqual({ deletedAt: expect.any(String) })
    const op = db.argsOf(3, "values")?.[0] as {
      seq: number
      payloadJson: string
    }
    expect(op.seq).toBe(5)
    expect(JSON.parse(op.payloadJson)).toEqual({
      kind: "delete",
      entryId: ENTRY,
    })
    expectCommitted()
  })

  test("an already-deleted passage is not_found", async () => {
    db.next([])
    expect(await entries.deleteEntry(input, CTX)).toEqual({
      ok: false,
      code: "not_found",
      error: "Passage not found.",
    })
    expect(bus.events).toEqual([])
  })

  test("bad ids are invalid", async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ storyId: "bad id", entryId: ENTRY }, "Invalid story id."],
      [{ storyId: STORY, entryId: "bad id" }, "Invalid entry id."],
    ]
    for (const [raw, error] of cases) {
      const result = await entries.deleteEntry(raw as never, CTX)
      expect(result).toEqual({ ok: false, code: "invalid", error })
    }
    expectNothingWritten()
  })

  test("refuses while a run holds the story", async () => {
    expect(reserveRun(STORY)).toBe(true)
    expect(await entries.deleteEntry(input, CTX)).toMatchObject({
      code: "conflict",
      error: RUNNING,
    })
    expectNothingWritten()
  })
})

describe("rewindToEntry", () => {
  const input = { storyId: STORY, entryId: ENTRY }

  test("cuts every live passage after the anchor as one rewind op", async () => {
    db.next([{ position: 4 }])
    db.next([{ id: "e5" }, { id: "e6" }])
    db.next([{ undoCursor: 1 }])
    const result = await entries.rewindToEntry(input, CTX)

    expect(result).toEqual({ ok: true, data: null })
    expect(roots()).toEqual([
      "select",
      "update",
      "select",
      "delete",
      "insert",
      "update",
      "update",
    ])
    const op = db.argsOf(4, "values")?.[0] as { payloadJson: string }
    expect(JSON.parse(op.payloadJson)).toEqual({
      kind: "rewind",
      entryIds: ["e5", "e6"],
    })
    expectCommitted()
  })

  test("an anchor the writer cannot see is not_found", async () => {
    db.next([])
    expect(await entries.rewindToEntry(input, CTX)).toEqual({
      ok: false,
      code: "not_found",
      error: "Passage not found.",
    })
    expect(bus.events).toEqual([])
  })

  test("nothing after the anchor is a conflict and journals nothing", async () => {
    db.next([{ position: 4 }])
    db.next([])
    expect(await entries.rewindToEntry(input, CTX)).toEqual({
      ok: false,
      code: "conflict",
      error: "There's nothing after this passage.",
    })
    expect(roots()).toEqual(["select", "update"])
    expect(bus.events).toEqual([])
  })

  test("bad ids are invalid", async () => {
    const result = await entries.rewindToEntry(
      { storyId: STORY, entryId: "bad id" },
      CTX
    )
    expect(result).toEqual({
      ok: false,
      code: "invalid",
      error: "Invalid entry id.",
    })
    expectNothingWritten()
  })

  test("refuses while a run holds the story", async () => {
    expect(reserveRun(STORY)).toBe(true)
    expect(await entries.rewindToEntry(input, CTX)).toMatchObject({
      code: "conflict",
      error: RUNNING,
    })
    expectNothingWritten()
  })
})

describe("loadOlderEntries", () => {
  const PAGE = { entries: [], windowStartPosition: null, hasMore: false }

  test("clamps the limit and passes the page through, writing nothing", async () => {
    const calls: unknown[][] = []
    stubQueries({
      listOlderEntries: async (...args: unknown[]) => {
        calls.push(args)
        return PAGE
      },
    })
    const defaulted = await entries.loadOlderEntries(
      { storyId: STORY, beforePosition: 40 },
      CTX
    )
    await entries.loadOlderEntries(
      { storyId: STORY, beforePosition: 40, limit: 9999 },
      CTX
    )
    await entries.loadOlderEntries(
      { storyId: STORY, beforePosition: 40, limit: 0 },
      CTX
    )

    expect(
      defaulted.ok && olderEntriesPageOutput.parse(defaulted.data)
    ).toEqual(PAGE)
    expect(calls).toEqual([
      [STORY, 40, 25],
      [STORY, 40, 500],
      [STORY, 40, 1],
    ])
    expectNothingWritten()
  })

  test("a failed read is failed, with the old sentence", async () => {
    stubQueries({
      listOlderEntries: async () => {
        throw new Error("boom")
      },
    })
    expect(
      await entries.loadOlderEntries({ storyId: STORY, beforePosition: 1 }, CTX)
    ).toEqual({
      ok: false,
      code: "failed",
      error: "Could not load earlier passages.",
    })
  })

  test("a position that is not a number is invalid", async () => {
    const result = await entries.loadOlderEntries(
      { storyId: STORY, beforePosition: "x" as never },
      CTX
    )
    expect(result).toEqual({
      ok: false,
      code: "invalid",
      error: "Invalid position.",
    })
  })
})

describe("loadEntryContext", () => {
  function passage(id: string, text: string, modelId?: string): StoryEntry {
    return {
      id,
      source: modelId ? "generated" : "user",
      text,
      actionKind: null,
      inputText: null,
      variantGroupId: id,
      variantIndex: 0,
      variantCount: 1,
      variantProfilesMixed: false,
      generation: modelId
        ? {
            modelId,
            thinking: "off",
            temperature: 1,
            profileName: null,
            promptTokens: null,
            completionTokens: null,
          }
        : null,
      costUsd: null,
      reasoningTokens: null,
      callStatus: null,
      createdAt: "2026-09-23T00:00:00.000Z",
    }
  }

  function story(): Story {
    return {
      id: STORY,
      title: "Test",
      description: "",
      genre: "",
      createdAt: "2026-09-23T00:00:00.000Z",
      updatedAt: "2026-09-23T00:00:00.000Z",
      wordCount: 0,
      tintHue: null,
      tintStrength: 1,
      tintAuto: true,
      entries: [
        passage("e1", "The lighthouse was dark."),
        passage(ENTRY, "Then it lit.", "~test/model"),
      ],
      images: [],
      imageModelId: null,
      profileId: null,
      settings: {
        modelId: "~test/model",
        thinking: "off",
        providerTag: null,
        zdr: false,
        temperature: 1,
        topP: 1,
        contextWindow: 8192,
        loreBudget: 25,
        frequencyPenalty: 0,
        presencePenalty: 0,
      },
      memory: "",
      summarize: true,
      summary: "",
      authorsNote: "",
      systemPrompt: null,
      activeLorebookEntryIds: [],
      canUndo: false,
      canRedo: false,
      undoSummary: null,
      redoSummary: null,
    }
  }

  test("composes from the manuscript before the passage and names its model", async () => {
    stubQueries({
      getStoryFull: async () => story(),
      listLorebookEntries: async () => [],
    })
    const result = await entries.loadEntryContext(
      { storyId: STORY, entryId: ENTRY },
      CTX
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const data = entryContextOutput.parse(result.data)
    expect(data?.modelId).toBe("~test/model")
    expect(data?.context.storyText).toContain("The lighthouse was dark.")
    expect(data?.context.storyText).not.toContain("Then it lit.")
    expectNothingWritten()
  })

  test("a passage no longer in the manuscript is ok(null)", async () => {
    stubQueries({
      getStoryFull: async () => story(),
      listLorebookEntries: async () => [],
    })
    expect(
      await entries.loadEntryContext({ storyId: STORY, entryId: "gone" }, CTX)
    ).toEqual({ ok: true, data: null })
  })

  test("a missing story is not_found", async () => {
    stubQueries({
      getStoryFull: async () => null,
      listLorebookEntries: async () => [],
    })
    expect(
      await entries.loadEntryContext({ storyId: STORY, entryId: ENTRY }, CTX)
    ).toEqual({ ok: false, code: "not_found", error: "Story not found." })
  })

  test("a read that throws is failed, with the old sentence", async () => {
    const quiet = console.error
    console.error = () => {}
    stubQueries({
      getStoryFull: async () => {
        throw new Error("boom")
      },
      listLorebookEntries: async () => [],
    })
    const result = await entries.loadEntryContext(
      { storyId: STORY, entryId: ENTRY },
      CTX
    )
    console.error = quiet
    expect(result).toEqual({
      ok: false,
      code: "failed",
      error: "Couldn't work out the context for this passage.",
    })
  })

  test("bad ids are invalid", async () => {
    expect(
      await entries.loadEntryContext({ storyId: "bad id", entryId: ENTRY }, CTX)
    ).toEqual({ ok: false, code: "invalid", error: "Invalid story id." })
  })
})
