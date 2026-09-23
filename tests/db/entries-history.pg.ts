// tests/db/entries-history.pg.ts — the entries and history services against a
// real Postgres: what the op journal records, what undo and redo replay, and
// that a write reaches the sync bus only after its transaction committed.
// See tests/db/harness.ts for how to run it.
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test"

import { and, asc, eq, isNull } from "drizzle-orm"

import { closeDb, getDb, migrateOnce, truncateAll } from "./harness"

const { storyEntries, storyOps } = await import("@/lib/db/schema")
const { releaseRun, reserveRun } = await import("@/lib/generation/live")
const { NO_ORIGIN } = await import("@/lib/services/context")
const entries = await import("@/lib/services/entries")
const history = await import("@/lib/services/history")
const { createStory } = await import("@/lib/services/stories")
const { subscribeBus } = await import("@/lib/sync/bus")
const { translateAction } = await import("@/lib/story/action-voice")

let storyId: string

beforeAll(migrateOnce)
afterAll(closeDb)

beforeEach(async () => {
  await truncateAll()
  const created = await createStory({ title: "Harbour" }, NO_ORIGIN)
  if (!created.ok) throw new Error(created.error)
  storyId = created.data.id
})

/** The manuscript as a reader sees it: active, not deleted, in order. */
async function live(): Promise<string[]> {
  const db = await getDb()
  const rows = await db
    .select({ text: storyEntries.text })
    .from(storyEntries)
    .where(
      and(
        eq(storyEntries.storyId, storyId),
        eq(storyEntries.isActive, true),
        isNull(storyEntries.deletedAt)
      )
    )
    .orderBy(asc(storyEntries.position))
  return rows.map((row) => row.text)
}

async function opCount(): Promise<number> {
  const db = await getDb()
  const rows = await db
    .select({ id: storyOps.id })
    .from(storyOps)
    .where(eq(storyOps.storyId, storyId))
  return rows.length
}

async function narrate(text: string): Promise<string> {
  const result = await entries.appendEntryOutsideRun(
    { storyId, mode: "narration", text },
    NO_ORIGIN
  )
  if (!result.ok) throw new Error(result.error)
  return result.data.entry.id
}

describe("the journal round trip", () => {
  test("a re-voiced turn undoes to its old voice and redoes to the new one", async () => {
    const appended = await entries.appendActionEntry(
      { storyId, kind: "say", rawText: "hello there" },
      NO_ORIGIN
    )
    if (!appended.ok) throw new Error(appended.error)
    const said = translateAction("say", "hello there")
    const done = translateAction("do", "wave")

    const edited = await entries.updateActionEntry(
      { storyId, entryId: appended.data.entry.id, rawText: "wave", kind: "do" },
      NO_ORIGIN
    )
    expect(edited.ok).toBe(true)
    expect(await live()).toEqual([done])

    const undone = await history.undoStoryOp({ storyId }, NO_ORIGIN)
    expect(undone.ok && undone.data).not.toBeNull()
    expect(await live()).toEqual([said])

    await history.redoStoryOp({ storyId }, NO_ORIGIN)
    expect(await live()).toEqual([done])
  })

  test("a rewind drops everything after the anchor, and undo brings it back", async () => {
    const first = await narrate("The tide went out.")
    await narrate("Gulls wheeled overhead.")
    await narrate("A bell rang in the fog.")

    const rewound = await entries.rewindToEntry(
      { storyId, entryId: first },
      NO_ORIGIN
    )
    expect(rewound.ok).toBe(true)
    expect(await live()).toEqual(["The tide went out."])

    await history.undoStoryOp({ storyId }, NO_ORIGIN)
    expect(await live()).toEqual([
      "The tide went out.",
      "Gulls wheeled overhead.",
      "A bell rang in the fog.",
    ])
  })

  test("a deleted passage comes back on undo", async () => {
    await narrate("One.")
    const second = await narrate("Two.")
    await narrate("Three.")

    const deleted = await entries.deleteEntry(
      { storyId, entryId: second },
      NO_ORIGIN
    )
    expect(deleted.ok).toBe(true)
    expect(await live()).toEqual(["One.", "Three."])

    await history.undoStoryOp({ storyId }, NO_ORIGIN)
    expect(await live()).toEqual(["One.", "Two.", "Three."])
  })

  test("a refused write records no op", async () => {
    await narrate("Only passage.")
    const before = await opCount()
    const result = await entries.updateEntryText(
      { storyId, entryId: "no-such-entry", text: "x" },
      NO_ORIGIN
    )
    expect(result).toMatchObject({ ok: false, code: "not_found" })
    expect(await opCount()).toBe(before)
  })
})

describe("the run guard", () => {
  test("a write during a run is a conflict and changes nothing", async () => {
    const id = await narrate("Before the run.")
    const ops = await opCount()
    expect(reserveRun(storyId)).toBe(true)
    try {
      const result = await entries.updateEntryText(
        { storyId, entryId: id, text: "During the run." },
        NO_ORIGIN
      )
      expect(result).toMatchObject({ ok: false, code: "conflict" })
    } finally {
      releaseRun(storyId)
    }
    expect(await live()).toEqual(["Before the run."])
    expect(await opCount()).toBe(ops)
  })
})

describe("magic sync", () => {
  test("the change event is published after the transaction commits", async () => {
    const id = await narrate("Draft.")
    const order = await recordCommits()
    const stop = subscribeBus((event) => {
      if (event.kind === "change" && event.storyId === storyId) {
        order.push("publish")
      }
    })
    try {
      const result = await entries.updateEntryText(
        { storyId, entryId: id, text: "Final." },
        NO_ORIGIN
      )
      expect(result.ok).toBe(true)
    } finally {
      stop()
    }
    // A publish inside the transaction would tell every device about a row a
    // rollback could still take back.
    expect(order).toEqual(["commit", "publish"])
    expect(await live()).toEqual(["Final."])
  })
})

/**
 * Logs each COMMIT the pool sends, into the array it returns. Wraps every
 * client as it is checked out, so reused connections are covered too.
 */
async function recordCommits(): Promise<string[]> {
  await getDb()
  const pool = (globalThis as { __draftZeroPool?: import("pg").Pool })
    .__draftZeroPool!
  const order: string[] = []
  pool.on("acquire", (client) => {
    const tagged = client as typeof client & { __commitSpy?: true }
    if (tagged.__commitSpy) return
    tagged.__commitSpy = true
    const query = client.query.bind(client) as (...args: unknown[]) => unknown
    ;(client as { query: unknown }).query = (...args: unknown[]) => {
      const text =
        typeof args[0] === "string"
          ? args[0]
          : (args[0] as { text?: string } | undefined)?.text
      if (text && /^\s*commit\b/i.test(text)) order.push("commit")
      return query(...args)
    }
  })
  return order
}
