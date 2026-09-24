// lib/mcp/tools/write.test.ts — handler shaping, over the real entries service
// and a scripted drizzle chain. No live DB.
//
// The tool module is imported at the top level, right after the shared mocks
// (see test-mocks.ts) are wired — not inside a test() body. mock.module
// patches its specifier for the whole run, so a dynamic `await import(...)`
// inside a test body would resolve against whatever the LAST file to touch
// these shared specifiers left behind, not this file's own doubles.
import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import type { RegisterTool } from "@/lib/mcp/helpers"
import { installMocks, resetActionMocks } from "@/lib/mcp/tools/test-mocks"
import { captureBus } from "@/lib/services/test-support"

const db = await installMocks()
const { registerWrite } = await import("@/lib/mcp/tools/write")
const { releaseRun, reserveRun } = await import("@/lib/generation/live")

/** Captures the handler a registrar hands to `server.registerTool`. */
function capture(register: RegisterTool) {
  let handler: (args: unknown) => Promise<unknown>
  const fakeServer = {
    registerTool: (_name: string, _config: unknown, h: typeof handler) => {
      handler = h
    },
  }
  register(fakeServer as never, {} as never)
  return (args: unknown) => handler(args)
}

/** Scripts storyExists and nextStoryPosition so the append lands at `position`. */
function appendsAt(position: number) {
  db.next([{ id: "s1" }])
  db.next([{ max: position - 1 }])
  db.next([{ max: null }])
}

/** The row appendEntryCore inserted (statement 3, after the three reads). */
function insertedRow() {
  expect(db.statements[3]?.root).toBe("insert")
  return db.argsOf(3, "values")?.[0] as Record<string, unknown>
}

let bus: Awaited<ReturnType<typeof captureBus>>

describe("write", () => {
  beforeEach(async () => {
    resetActionMocks(db)
    bus = await captureBus()
  })
  afterEach(() => {
    bus.stop()
    releaseRun("s1")
  })

  test("narration appends as narration, through the run-guarded entry point", async () => {
    appendsAt(5)
    const call = capture(registerWrite)

    const result = (await call({
      storyId: "s1",
      text: "The door creaks open.",
    })) as { structuredContent: Record<string, unknown> }

    expect(insertedRow()).toMatchObject({
      storyId: "s1",
      text: "The door creaks open.",
      actionKind: null,
      inputText: null,
    })
    expect(bus.events).toEqual([{ kind: "change", storyId: "s1" }])
    expect(db.revalidated).toEqual(["/"])
    expect(result.structuredContent).toEqual({
      storyId: "s1",
      position: 5,
      kind: "narration",
      words: 4,
    })
  })

  test("do/say appends with the given mode, translated", async () => {
    appendsAt(12)
    const call = capture(registerWrite)

    const result = (await call({
      storyId: "s1",
      mode: "do",
      text: "open the door",
    })) as { structuredContent: Record<string, unknown> }

    expect(insertedRow()).toMatchObject({
      actionKind: "do",
      inputText: "open the door",
    })
    expect(result.structuredContent).toMatchObject({ position: 12, kind: "do" })
  })

  test("never echoes prose back in structuredContent", async () => {
    appendsAt(1)
    const call = capture(registerWrite)

    const result = (await call({
      storyId: "s1",
      text: "Some long passage of prose.",
    })) as { structuredContent: Record<string, unknown> }

    expect(JSON.stringify(result.structuredContent)).not.toContain(
      "Some long passage"
    )
  })

  test("a failed append becomes a failed() result, not a throw", async () => {
    db.next([])
    const call = capture(registerWrite)

    const result = (await call({ storyId: "nope", text: "x" })) as {
      isError?: boolean
      content: { text: string }[]
    }

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toBe("Story not found.")
    expect(bus.events).toEqual([])
  })

  test("refuses while a generation holds the story", async () => {
    reserveRun("s1")
    const call = capture(registerWrite)

    const result = (await call({ storyId: "s1", text: "x" })) as {
      isError?: boolean
      content: { text: string }[]
    }

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain("A generation is running")
    expect(db.statements).toEqual([])
    expect(bus.events).toEqual([])
  })
})
