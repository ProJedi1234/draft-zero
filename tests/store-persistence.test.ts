// tests/store-persistence.test.ts — design doc §7's persistence contract,
// exercised against InMemoryPersistence (bun has no IndexedDB). The stamp
// rule is the one thing here that matters beyond "a cache round-trips": a
// stale tab's pagehide flush must never clobber what a live tab already
// wrote.

import { describe, expect, test } from "bun:test"

import {
  createPersister,
  InMemoryPersistence,
  type PersistedRow,
  type StorePersistence,
} from "@/lib/store/persistence"

function row(id: string, version = "v1"): PersistedRow {
  return { id, version, row: { id, version } }
}

describe("InMemoryPersistence", () => {
  test("round-trips rows per entity, isolated from other entities", async () => {
    const p = new InMemoryPersistence()
    await p.replaceAll("story", [row("a"), row("b")], 1)
    await p.replaceAll("app-settings", [row("settings")], 1)

    expect((await p.load("story")).map((r) => r.id).sort()).toEqual(["a", "b"])
    expect((await p.load("app-settings")).map((r) => r.id)).toEqual([
      "settings",
    ])
    expect(await p.load("lorebook-entry")).toEqual([])
  })

  test("replaceAll fully replaces — old ids are gone", async () => {
    const p = new InMemoryPersistence()
    await p.replaceAll("story", [row("a"), row("b")], 1)
    await p.replaceAll("story", [row("c")], 2)

    expect((await p.load("story")).map((r) => r.id)).toEqual(["c"])
  })

  test("an older stamp writes nothing; the newer table survives", async () => {
    const p = new InMemoryPersistence()
    await p.replaceAll("story", [row("newer")], 10)
    await p.replaceAll("story", [row("stale")], 5)

    expect((await p.load("story")).map((r) => r.id)).toEqual(["newer"])
  })

  test("an equal stamp is allowed to write", async () => {
    const p = new InMemoryPersistence()
    await p.replaceAll("story", [row("first")], 10)
    await p.replaceAll("story", [row("second")], 10)

    expect((await p.load("story")).map((r) => r.id)).toEqual(["second"])
  })
})

describe("createPersister", () => {
  test("coalesces a burst of onStoreChanged into one replaceAll", async () => {
    let calls = 0
    const inner = new InMemoryPersistence()
    const wrapper: StorePersistence = {
      load: (e) => inner.load(e),
      destroy: () => inner.destroy(),
      replaceAll: (e, rows, stamp) => {
        calls++
        return inner.replaceAll(e, rows, stamp)
      },
    }

    const stamp = 0
    const persister = createPersister(
      wrapper,
      () => [row("a")],
      () => stamp,
      { delayMs: 5 }
    )

    persister.onStoreChanged()
    persister.onStoreChanged()
    persister.onStoreChanged()

    await new Promise((r) => setTimeout(r, 30))

    expect(calls).toBe(1)
    persister.dispose()
  })

  test("flush() writes immediately, bypassing the debounce timer", async () => {
    let calls = 0
    const inner = new InMemoryPersistence()
    const wrapper: StorePersistence = {
      load: (e) => inner.load(e),
      destroy: () => inner.destroy(),
      replaceAll: (e, rows, stamp) => {
        calls++
        return inner.replaceAll(e, rows, stamp)
      },
    }

    const persister = createPersister(
      wrapper,
      () => [row("a")],
      () => 1,
      { delayMs: 500 }
    )
    persister.onStoreChanged()
    persister.flush()

    // flush fires immediately (fire-and-forget); give the microtask a tick
    await new Promise((r) => setTimeout(r, 10))

    expect(calls).toBe(1)
    persister.dispose()
  })

  test("overlapping writes serialize — the second waits for the first", async () => {
    const order: string[] = []
    let resolveFirst!: () => void
    const firstGate = new Promise<void>((r) => {
      resolveFirst = r
    })

    let call = 0
    const fake: StorePersistence = {
      load: async () => [],
      destroy: async () => {},
      replaceAll: async () => {
        call++
        if (call === 1) {
          order.push("first-start")
          await firstGate
          order.push("first-end")
        } else {
          order.push("second-start")
        }
      },
    }

    const persister = createPersister(
      fake,
      () => [],
      () => 1,
      { delayMs: 0 }
    )
    persister.flush()
    // give the first write's microtask a chance to start before queuing the second
    await new Promise((r) => setTimeout(r, 5))
    persister.flush()

    // second write must not have started while the first is still gated
    expect(order).toEqual(["first-start"])

    resolveFirst()
    await new Promise((r) => setTimeout(r, 10))

    expect(order).toEqual(["first-start", "first-end", "second-start"])
    persister.dispose()
  })

  test("a rejecting persistence never throws out of the persister", async () => {
    const fake: StorePersistence = {
      load: async () => [],
      destroy: async () => {},
      replaceAll: async () => {
        throw new Error("boom")
      },
    }

    const persister = createPersister(
      fake,
      () => [row("a")],
      () => 1,
      { delayMs: 0 }
    )

    expect(() => persister.flush()).not.toThrow()
    await new Promise((r) => setTimeout(r, 10))
    // second call after a rejected chain must also not throw and must still run
    expect(() => persister.flush()).not.toThrow()
    await new Promise((r) => setTimeout(r, 10))
    persister.dispose()
  })
})
