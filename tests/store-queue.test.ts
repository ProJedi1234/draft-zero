// tests/store-queue.test.ts — The optimistic queue. The interesting properties
// are all about what happens when a write does NOT go cleanly: a rollback must
// not eat a foreign write that landed underneath the overlay, a server refusal
// must not be retried, an offline park must stay capped (a serial queue with an
// indefinite head strands everything behind it), and localRefresh.pending must
// be back at zero during every wait or the RSC lane stalls for as long as the
// queue does.

import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import {
  configureMutationQueue,
  mutationQueue,
  resetMutationQueueConfig,
  type CanonicalRow,
  type MutationOutcome,
  type QueuedMutation,
  type StorePatch,
} from "@/lib/store/mutation-queue"
import { clientStore } from "@/lib/store/store"
import type { StoryRecord } from "@/lib/store/records"
import { localRefresh } from "@/lib/sync/client"

function story(id: string, updatedAt: string, title = id): StoryRecord {
  return {
    id,
    title,
    description: "",
    genre: "",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt,
    wordCount: 0,
    tintHue: null,
    tintStrength: 1,
    tintAuto: true,
  }
}

function canonicalUpsert(row: StoryRecord): CanonicalRow {
  return {
    entity: "story",
    op: "upsert",
    id: row.id,
    version: row.updatedAt,
    row,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function mutation(
  id: string,
  patches: StorePatch[],
  run: () => Promise<MutationOutcome>
): QueuedMutation {
  return { id, label: id, patches, run }
}

beforeEach(() => {
  clientStore.reset()
  mutationQueue.reset()
  localRefresh.pending = 0
  // A ladder short enough to run in a test, and an offline signal a test owns.
  configureMutationQueue({
    backoffMs: [1, 1, 1],
    offlineWaitMs: 5,
    isOffline: () => false,
    waitForOnline: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  })
})

afterEach(() => {
  resetMutationQueueConfig()
})

describe("optimistic visibility", () => {
  test("the row is on screen before run() resolves", async () => {
    const gate = deferred<MutationOutcome>()
    const ghost = story("ghost", "2026-08-09T00:00:00.000Z", "Untitled Story")

    const settled = mutationQueue.enqueue(
      mutation(
        "m1",
        [{ entity: "story", op: "upsert", row: ghost }],
        () => gate.promise
      )
    )

    const view = clientStore.getView()
    expect(view.stories.map((s) => s.id)).toEqual(["ghost"])
    expect(view.stories[0].pending).toBe(true)
    expect(view.pendingCount).toBe(1)

    gate.resolve({
      ok: true,
      canonical: [
        canonicalUpsert(
          story("ghost", "2026-08-09T00:00:01.000Z", "Untitled Story")
        ),
      ],
    })
    await settled

    const after = clientStore.getView()
    expect(after.pendingCount).toBe(0)
    expect(after.stories[0].pending).toBe(false)
    expect(after.stories[0].updatedAt).toBe("2026-08-09T00:00:01.000Z")
  })
})

describe("serial drain", () => {
  test("mutations run one at a time, in enqueue order", async () => {
    const order: string[] = []
    const gate1 = deferred<MutationOutcome>()

    const first = mutationQueue.enqueue(
      mutation("m1", [{ entity: "story", op: "delete", id: "a" }], () => {
        order.push("start-1")
        return gate1.promise
      })
    )
    const second = mutationQueue.enqueue(
      mutation("m2", [{ entity: "story", op: "delete", id: "b" }], async () => {
        order.push("start-2")
        return { ok: true, canonical: [] }
      })
    )

    await Promise.resolve()
    expect(order).toEqual(["start-1"])
    expect(clientStore.getView().pendingCount).toBe(2)

    gate1.resolve({ ok: true, canonical: [] })
    await Promise.all([first, second])
    expect(order).toEqual(["start-1", "start-2"])
    expect(clientStore.getView().pendingCount).toBe(0)
  })
})

describe("confirm and rollback", () => {
  test("a foreign write landing mid-flight survives a rollback", async () => {
    const gate = deferred<MutationOutcome>()
    const settled = mutationQueue.enqueue(
      mutation(
        "m1",
        [{ entity: "story", op: "merge", id: "a", fields: { title: "Mine" } }],
        () => gate.promise
      )
    )

    // Another device renames the same story while ours is in flight.
    clientStore.ingest({
      type: "entity",
      op: "upsert",
      entity: "story",
      id: "a",
      storyId: "a",
      version: "2026-08-10T00:00:00.000Z",
      origin: "other-device",
      data: story("a", "2026-08-10T00:00:00.000Z", "Theirs"),
    })
    expect(clientStore.getView().stories[0].title).toBe("Mine")

    gate.resolve({ ok: false, error: "Story not found." })
    const outcome = await settled
    expect(outcome.ok).toBe(false)

    // Rollback drops the overlay, revealing the foreign write untouched.
    expect(clientStore.getView().stories[0].title).toBe("Theirs")
  })

  test("confirm folds canonical rows idempotently with the bus echo", async () => {
    const canonical = canonicalUpsert(
      story("a", "2026-08-10T00:00:00.000Z", "Renamed")
    )
    // The echo arrives first, at the same version the action will return.
    clientStore.ingest({
      type: "entity",
      op: "upsert",
      entity: "story",
      id: "a",
      storyId: "a",
      version: "2026-08-10T00:00:00.000Z",
      origin: null,
      data: story("a", "2026-08-10T00:00:00.000Z", "Renamed"),
    })

    await mutationQueue.enqueue(
      mutation(
        "m1",
        [
          {
            entity: "story",
            op: "merge",
            id: "a",
            fields: { title: "Renamed" },
          },
        ],
        async () => ({ ok: true, canonical: [canonical] })
      )
    )

    const view = clientStore.getView()
    expect(view.stories).toHaveLength(1)
    expect(view.stories[0].title).toBe("Renamed")
    expect(view.pendingCount).toBe(0)
  })

  test("a canonical delete tombstones the row", async () => {
    clientStore.applySnapshot(
      [
        {
          id: "a",
          version: "2026-08-09T00:00:00.000Z",
          row: story("a", "2026-08-09T00:00:00.000Z"),
        },
      ],
      new Set(["a"]),
      0
    )
    await mutationQueue.enqueue(
      mutation(
        "m1",
        [{ entity: "story", op: "delete", id: "a" }],
        async () => ({
          ok: true,
          canonical: [
            {
              entity: "story",
              op: "delete",
              id: "a",
              version: "2026-08-10T00:00:00.000Z",
            },
          ],
        })
      )
    )
    expect(clientStore.getView().stories).toEqual([])
    expect(clientStore.getState().story.tombstones.has("a")).toBe(true)
  })
})

describe("failure taxonomy", () => {
  test("a server rejection is never retried", async () => {
    let attempts = 0
    const outcome = await mutationQueue.enqueue(
      mutation("m1", [{ entity: "story", op: "delete", id: "a" }], async () => {
        attempts++
        return { ok: false, error: "Title cannot be empty." }
      })
    )
    expect(attempts).toBe(1)
    expect(outcome).toEqual({ ok: false, error: "Title cannot be empty." })
    expect(clientStore.getView().pendingCount).toBe(0)
  })

  test("a thrown run() retries up to three attempts, then fails", async () => {
    let attempts = 0
    const outcome = await mutationQueue.enqueue(
      mutation("m1", [{ entity: "story", op: "delete", id: "a" }], async () => {
        attempts++
        throw new TypeError("Failed to fetch")
      })
    )
    expect(attempts).toBe(3)
    expect(outcome).toEqual({ ok: false, error: "Failed to fetch" })
  })

  test("a retry that succeeds confirms normally", async () => {
    let attempts = 0
    const row = story("a", "2026-08-10T00:00:00.000Z", "Saved")
    const outcome = await mutationQueue.enqueue(
      mutation(
        "m1",
        [{ entity: "story", op: "merge", id: "a", fields: { title: "Saved" } }],
        async () => {
          attempts++
          if (attempts < 3) throw new TypeError("Failed to fetch")
          return { ok: true, canonical: [canonicalUpsert(row)] }
        }
      )
    )
    expect(outcome.ok).toBe(true)
    expect(clientStore.getView().stories[0].title).toBe("Saved")
  })

  test("an offline park is capped and consumes attempt slots", async () => {
    let waits = 0
    configureMutationQueue({
      isOffline: () => true,
      waitForOnline: (ms) => {
        waits++
        expect(ms).toBe(5)
        return new Promise((resolve) => setTimeout(resolve, ms))
      },
    })

    let attempts = 0
    const outcome = await mutationQueue.enqueue(
      mutation("m1", [{ entity: "story", op: "delete", id: "a" }], async () => {
        attempts++
        throw new TypeError("Failed to fetch")
      })
    )
    // Three attempts, two waits — bounded, whether or not the network returned.
    expect(attempts).toBe(3)
    expect(waits).toBe(2)
    expect(outcome.ok).toBe(false)
  })
})

describe("dependent mutations", () => {
  test("a queued patch on a failed create's row is dropped with it", async () => {
    const gate = deferred<MutationOutcome>()
    const ghost = story("ghost", "2026-08-09T00:00:00.000Z", "Untitled Story")

    const create = mutationQueue.enqueue(
      mutation(
        "m1",
        [{ entity: "story", op: "upsert", row: ghost }],
        () => gate.promise
      )
    )
    const rename = mutationQueue.enqueue(
      mutation(
        "m2",
        [
          {
            entity: "story",
            op: "merge",
            id: "ghost",
            fields: { title: "Named" },
          },
        ],
        async () => {
          throw new Error("must not run")
        }
      )
    )

    gate.resolve({ ok: false, error: "Could not create story." })
    const [createOutcome, renameOutcome] = await Promise.all([create, rename])
    expect(createOutcome).toEqual({
      ok: false,
      error: "Could not create story.",
    })
    expect(renameOutcome).toEqual({
      ok: false,
      error: "A change this depended on failed.",
    })
    expect(clientStore.getView().stories).toEqual([])
    expect(clientStore.getView().pendingCount).toBe(0)
  })
})

describe("localRefresh bracketing", () => {
  test("the counter is zero between attempts and after every path settles", async () => {
    const duringWaits: number[] = []
    configureMutationQueue({
      isOffline: () => {
        duringWaits.push(localRefresh.pending)
        return false
      },
    })

    const seen: number[] = []
    await mutationQueue.enqueue(
      mutation("m1", [{ entity: "story", op: "delete", id: "a" }], async () => {
        seen.push(localRefresh.pending)
        throw new TypeError("Failed to fetch")
      })
    )

    // Raised for the awaited call only, never across the backoff.
    expect(seen).toEqual([1, 1, 1])
    expect(duringWaits).toEqual([0, 0])
    expect(localRefresh.pending).toBe(0)

    await mutationQueue.enqueue(
      mutation(
        "m2",
        [{ entity: "story", op: "delete", id: "b" }],
        async () => ({
          ok: true,
          canonical: [],
        })
      )
    )
    expect(localRefresh.pending).toBe(0)
  })
})
