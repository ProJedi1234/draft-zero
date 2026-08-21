// tests/generation-stream.test.ts — The specification for the live-run
// registry and its detached loop (lib/generation/live.ts), plus the mock
// provider's event sequence.
//
// The registry is the part worth pinning down. The server owns every
// generation now, and each of these cases is a promise the clients build on:
// a subscriber's snapshot plus its live events reconstruct the run exactly, a
// disappearing subscriber changes nothing, and the terminal `end` frame is a
// statement of fact — by the time it is sent the passage is on disk. The
// failure modes are all silent: a lost sentence in someone's manuscript, or a
// run that never ends because a dead socket threw into its loop.
//
// The provider and persist layers are stubbed and *recorded*, and the REAL
// ledger modules run against a recording fake database — their write semantics
// live in generation-calls.test.ts. What is asserted here is when and whether
// the loop calls each of them, which is the part the old /api/generate route
// used to own. Only leaf infrastructure is mocked (db client, key, provider,
// persist): mocking a module another test file imports as its SUBJECT poisons
// that file, because mock.module is process-global.

import { beforeEach, describe, expect, mock, test } from "bun:test"

import { MockGenerationProvider } from "@/lib/generation/mock-provider"
import type {
  ComposedContext,
  GenerationEvent,
  GenerationUsage,
} from "@/lib/generation/types"
import type { RunEndFrame, RunWireEvent } from "@/lib/sync/types"
import type { GenerationSettings, ThinkingLevel } from "@/lib/types"

// `server-only` throws on import outside a React Server Component graph, and
// the modules under test import it on purpose. Neutralising the marker is the
// only way to unit-test a server module at all.
mock.module("server-only", () => ({}))

// ---------------------------------------------------------------------------
// Scripted provider: each test declares the stream it wants, gates included.

type Script = (signal: AbortSignal) => AsyncGenerator<GenerationEvent>

let script: Script = async function* () {
  throw new Error("test forgot to set a script")
}

mock.module("@/lib/generation/openrouter", () => ({
  streamCompletion: (opts: { signal: AbortSignal }) => script(opts.signal),
  mapOpenRouterError: (err: unknown) => ({
    status: 500,
    message:
      err instanceof Error ? err.message : "Generation failed. Try again.",
  }),
}))

let currentKey: string | null = "sk-or-test"
mock.module("@/lib/generation/key", () => ({
  resolveOpenRouterKey: () => currentKey,
}))

// The ledger runs for real against this recording fake — the loop's contract
// with it is the old route's: row before first byte, one settle per run,
// reconcile only for a call that never finished.
const inserts: Array<Record<string, unknown>> = []
const updates: Array<{ set: Record<string, unknown> }> = []
const fakeDb = {
  insert() {
    return {
      async values(values: Record<string, unknown>) {
        inserts.push(values)
      },
    }
  },
  update() {
    const call = { set: {} as Record<string, unknown> }
    const builder = {
      set(values: Record<string, unknown>) {
        call.set = values
        return builder
      },
      where() {
        updates.push(call)
        return Promise.resolve()
      },
    }
    return builder
  },
  select(): never {
    // Only resolveStory selects in this suite, and it treats a failing db as
    // "story gone" — which is the behavior under test.
    throw new Error("no select in this suite")
  },
  // deleteStory's one statement; the row always "exists" so the action reaches
  // its refreshes.
  delete() {
    return {
      where() {
        return { returning: async () => [{ id: "deleted" }] }
      },
    }
  },
}
/** Settle statements, told apart from the sweep's by shape (see generation-calls.test.ts). */
function settles() {
  return updates.filter((u) => "costUsd" in u.set)
}

// Persist stub. `order` is the settle-path chronology — persist, bus change,
// end frame — which is where invariant 3 either holds or doesn't.
const order: string[] = []
const persists: Array<{
  storyId: string
  text: string
  opts: Record<string, unknown>
}> = []
let persistOk = true
mock.module("@/lib/db/entry-writes", () => ({
  persistGeneratedEntry: async (
    storyId: string,
    text: string,
    opts: Record<string, unknown>
  ) => {
    order.push("persist")
    persists.push({ storyId, text, opts })
    return persistOk
      ? { ok: true, data: { entry: { id: `entry-${persists.length}` } } }
      : { ok: false, error: "That passage is no longer in the story." }
  },
}))

mock.module("@/lib/db/client", () => ({
  getDb: async () => fakeDb,
}))

// deleteStory (the one action under test here — it must take the story's live
// run with it) calls revalidatePath, which throws without a request scope.
mock.module("next/cache", () => ({ revalidatePath: () => {} }))

const live = await import("@/lib/generation/live")
const { subscribeBus } = await import("@/lib/sync/bus")
const { deleteStory } = await import("@/lib/actions/stories")

// ---------------------------------------------------------------------------

const context: ComposedContext = {
  systemPrompt: "narrate",
  memory: "",
  lore: [],
  storyText: "",
  authorsNote: "",
  seed: 0,
  approxTokens: 128,
  fit: {
    loreMatched: 0,
    loreStableMatched: 0,
    storyChars: 0,
    storyCharsKept: 0,
  },
}

function settings(overrides: Partial<GenerationSettings> = {}) {
  return {
    modelId: "~test/model",
    thinking: "off" as ThinkingLevel,
    providerTag: null,
    temperature: 1,
    topP: 1,
    maxTokens: 200,
    frequencyPenalty: 0,
    presencePenalty: 0,
    contextWindow: 8192,
    ...overrides,
  } as GenerationSettings
}

const USAGE: GenerationUsage = {
  promptTokens: 10,
  completionTokens: 4,
  reasoningTokens: 0,
  costUsd: 0.0001,
  cachedPromptTokens: null,
  upstreamPromptCostUsd: null,
  upstreamCompletionCostUsd: null,
  isByok: null,
}

const META: GenerationEvent = {
  type: "meta",
  generationId: "gen-abc",
  callId: null,
}

/** Unique per test — the registry is process-global on purpose (dev HMR). */
let storySeq = 0
function nextStoryId() {
  return `story-${++storySeq}`
}

function launch(
  storyId: string,
  over: Partial<Parameters<typeof live.launchRun>[0]> = {}
): string {
  const launched = live.launchRun({
    storyId,
    requestKind: "generate",
    userEntryId: "user-1",
    removingEntryIds: [],
    turnId: "turn-1",
    context,
    settings: settings(),
    profileName: null,
    ...over,
  })
  if (!launched) throw new Error("launch refused")
  return launched.runId
}

function attach(storyId: string, runId?: string) {
  const run = live.findRun(storyId, runId ?? null)
  if (!run) throw new Error("no run to attach to")
  const events: RunWireEvent[] = []
  let resolveEnd!: (end: RunEndFrame) => void
  const ended = new Promise<RunEndFrame>((r) => (resolveEnd = r))
  const attachment = live.attachRun(run, (event) => {
    events.push(event)
    if (event.type === "end") {
      order.push("end")
      resolveEnd(event)
    }
  })
  if (attachment.end) resolveEnd(attachment.end)
  return {
    frame: attachment.frame,
    buffered: attachment.end,
    events,
    ended,
    detach: attachment.detach,
  }
}

/** Polls until `get` is truthy — for asserting on a run nobody subscribes to. */
async function until<T>(get: () => T | null | undefined | false): Promise<T> {
  for (let i = 0; i < 400; i++) {
    const value = get()
    if (value) return value
    await new Promise((r) => setTimeout(r, 5))
  }
  throw new Error("timed out waiting")
}

function gate() {
  let open!: () => void
  const opened = new Promise<void>((r) => (open = r))
  return { open, opened }
}

function proseOf(events: RunWireEvent[]): string {
  return events.reduce(
    (text, e) => (e.type === "text" ? text + e.value : text),
    ""
  )
}

beforeEach(() => {
  inserts.length = 0
  updates.length = 0
  persists.length = 0
  order.length = 0
  persistOk = true
  currentKey = "sk-or-test"
})

describe("the run registry and loop", () => {
  test("a subscriber sees the run's facts, the prose live, and an end that is already persisted", async () => {
    script = async function* () {
      yield META
      yield { type: "text", value: "The rain " }
      yield { type: "text", value: "had stopped." }
      yield { type: "usage", usage: USAGE }
    }
    const storyId = nextStoryId()
    const runId = launch(storyId)
    const sub = attach(storyId, runId)

    // Fresh attach: nothing has streamed, so the snapshot is empty — and it
    // carries the identity a late device needs to render the turn.
    expect(sub.frame).toEqual({
      type: "run",
      runId,
      storyId,
      requestKind: "generate",
      userEntryId: "user-1",
      removingEntryIds: [],
      reasoningChars: 0,
      text: "",
    })

    const end = await sub.ended
    expect(end.status).toBe("ok")
    expect(end.entryId).toBe("entry-1")
    expect(end.error).toBeNull()
    expect(end.usage).toEqual(USAGE)

    // The persist got the whole continuation, tied to the turn and the ledger
    // row the loop opened.
    expect(persists).toHaveLength(1)
    expect(persists[0].storyId).toBe(storyId)
    expect(persists[0].text).toBe("The rain had stopped.")
    expect(persists[0].opts.turnId).toBe("turn-1")
    expect(persists[0].opts.callId).toBe(inserts[0].id)

    // Invariant: `end` is emitted only after the persist committed.
    expect(order).toEqual(["persist", "end"])

    // `meta` is server bookkeeping and never reaches a subscriber.
    expect(sub.events.map((e) => e.type as string)).not.toContain("meta")
    expect(proseOf(sub.events)).toBe("The rain had stopped.")
  })

  test("the ledger row opens before prose and settles ok exactly once", async () => {
    script = async function* () {
      yield META
      yield { type: "text", value: "Snow." }
      yield { type: "usage", usage: USAGE }
    }
    const storyId = nextStoryId()
    const sub = attach(storyId, launch(storyId, { requestKind: "continue" }))
    await sub.ended

    expect(inserts).toHaveLength(1)
    expect(inserts[0].status).toBe("streaming")
    expect(inserts[0].origStoryId).toBe(storyId)
    // The db cannot answer selects in this suite, so the verified pair is
    // null — a cost is a cost even when the story cannot be confirmed.
    expect(inserts[0].storyId).toBeNull()
    expect(inserts[0].requestKind).toBe("continue")

    expect(settles()).toHaveLength(1)
    expect(settles()[0].set.status).toBe("ok")
    expect(settles()[0].set.openrouterGenerationId).toBe("gen-abc")
  })

  test("a retry run carries its slot and what it supersedes to every attacher", async () => {
    script = async function* () {
      yield { type: "text", value: "Another take." }
    }
    const storyId = nextStoryId()
    const runId = launch(storyId, {
      requestKind: "retry",
      userEntryId: null,
      variantGroupId: "slot-1",
      removingEntryIds: ["old-take"],
    })
    const sub = attach(storyId, runId)

    expect(sub.frame.requestKind).toBe("retry")
    expect(sub.frame.userEntryId).toBeNull()
    expect(sub.frame.removingEntryIds).toEqual(["old-take"])

    await sub.ended
    expect(persists[0].opts.variantGroupId).toBe("slot-1")
  })

  test("the take records the profile its run was launched under", async () => {
    script = async function* () {
      yield { type: "text", value: "A second opinion." }
    }
    const storyId = nextStoryId()
    const sub = attach(
      storyId,
      launch(storyId, { requestKind: "retry", profileName: "Swift" })
    )

    await sub.ended
    // The name, not the settings: the settings are already on the row, and a
    // month from now they cannot be traced back to the profile that chose them.
    expect(
      (persists[0].opts.generation as { profileName: string | null })
        .profileName
    ).toBe("Swift")
  })

  test("a take generated under no profile records none, rather than a guess", async () => {
    script = async function* () {
      yield { type: "text", value: "Custom settings wrote this." }
    }
    const storyId = nextStoryId()
    const sub = attach(storyId, launch(storyId))

    await sub.ended
    expect(
      (persists[0].opts.generation as { profileName: string | null })
        .profileName
    ).toBeNull()
  })

  test("a late attacher gets the history compressed into its snapshot, never replayed", async () => {
    const hold = gate()
    script = async function* () {
      yield { type: "text", value: "Snow began " }
      await hold.opened
      yield { type: "text", value: "to fall." }
    }
    const storyId = nextStoryId()
    const runId = launch(storyId)

    const first = attach(storyId, runId)
    await until(() => first.events.some((e) => e.type === "text"))

    // Attaching mid-run: everything so far is IN the frame, and only what
    // comes after arrives as events — each byte exactly once.
    const second = attach(storyId, runId)
    expect(second.frame.text).toBe("Snow began ")
    hold.open()

    const end = await second.ended
    expect(second.frame.text + proseOf(second.events)).toBe(
      "Snow began to fall."
    )
    // Two subscribers, one run: one persisted entry, one settle.
    expect(end.entryId).toBe("entry-1")
    expect(persists).toHaveLength(1)
    expect(settles()).toHaveLength(1)
  })

  test("subscribers coming and going never abort the run", async () => {
    const hold = gate()
    script = async function* () {
      yield { type: "text", value: "Nobody is " }
      await hold.opened
      yield { type: "text", value: "watching." }
    }
    const storyId = nextStoryId()
    const runId = launch(storyId)

    const sub = attach(storyId, runId)
    await until(() => sub.events.some((e) => e.type === "text"))
    // The tab closed. The listener goes; the model does not hear about it.
    sub.detach()
    hold.open()

    // With zero subscribers left, the run still finishes and still persists.
    const finished = await until(() => live.findRun(storyId, runId)?.end)
    expect(finished.status).toBe("ok")
    expect(finished.entryId).toBe("entry-1")
    expect(persists[0].text).toBe("Nobody is watching.")
    expect(settles()[0].set.status).toBe("ok")
  })

  test("stopRun aborts, the partial prose persists, and the cost is asked after", async () => {
    // Reconciliation is real here, so its fetch and its backoff have to be
    // tamed for the assertion — the same collapse generation-calls.test.ts
    // uses, scoped to this one test.
    const realFetch = globalThis.fetch
    const realSetTimeout = globalThis.setTimeout
    const asked: string[] = []
    globalThis.fetch = (async (url: string) => {
      asked.push(String(url))
      return new Response(null, { status: 404 })
    }) as unknown as typeof fetch
    globalThis.setTimeout = ((fn: () => void) =>
      realSetTimeout(fn, 0)) as unknown as typeof setTimeout
    try {
      script = async function* (signal) {
        yield META
        yield { type: "text", value: "Half a sentence" }
        await new Promise<void>((r) =>
          signal.addEventListener("abort", () => r(), { once: true })
        )
      }
      const storyId = nextStoryId()
      const sub = attach(storyId, launch(storyId))
      await until(() => sub.events.some((e) => e.type === "text"))
      // Bare stop (no runId): the start's turnId is the token that proves the
      // run is the caller's own.
      live.stopRun(storyId, null, "turn-1")

      const end = await sub.ended
      expect(end.status).toBe("aborted")
      // Stop keeps what streamed — same bargain as always.
      expect(end.entryId).toBe("entry-1")
      expect(persists[0].text).toBe("Half a sentence")
      expect(settles()[0].set.status).toBe("aborted")
      // Aborted with a generation id: the only remaining way to learn what
      // the call cost, so the loop goes and asks.
      await until(() => asked.length >= 3)
      expect(asked[0]).toContain("id=gen-abc")
    } finally {
      globalThis.fetch = realFetch
      globalThis.setTimeout = realSetTimeout
    }
  })

  test("a stop before any prose persists nothing", async () => {
    script = async function* (signal) {
      yield META
      await new Promise<void>((r) =>
        signal.addEventListener("abort", () => r(), { once: true })
      )
    }
    const storyId = nextStoryId()
    const sub = attach(storyId, launch(storyId))
    // The row is open (the call is billed) but no text ever arrived.
    await until(() => inserts.length > 0)
    live.stopRun(storyId, null, "turn-1")

    const end = await sub.ended
    expect(end.status).toBe("aborted")
    expect(end.entryId).toBeNull()
    expect(persists).toHaveLength(0)
    expect(settles()[0].set.status).toBe("aborted")
  })

  test("a stop landing before the first byte ends the run aborted, not error", async () => {
    // The real streamCompletion's fetch throws its abort before yielding
    // anything; a deliberate Stop in that window must not fan out as an error
    // toast on every device — and, having never reached a provider, must not
    // open a ledger row.
    script = async function* (signal) {
      await new Promise<never>((_, reject) => {
        const bail = () => reject(new Error("Request was aborted."))
        if (signal.aborted) return bail()
        signal.addEventListener("abort", bail, { once: true })
      })
    }
    const storyId = nextStoryId()
    const sub = attach(storyId, launch(storyId))
    live.stopRun(storyId, null, "turn-1")

    const end = await sub.ended
    expect(end.status).toBe("aborted")
    expect(end.entryId).toBeNull()
    expect(end.error).toBeNull()
    expect(inserts).toHaveLength(0)
    expect(settles()).toHaveLength(0)
    expect(persists).toHaveLength(0)
  })

  test("a stop naming another run is a no-op; naming the active one aborts it", async () => {
    // The stale-device case: a Stop sent for the run a device was watching
    // must never kill the newer run that owns the story now.
    script = async function* (signal) {
      yield { type: "text", value: "Half a take" }
      await new Promise<void>((r) => {
        if (signal.aborted) return r()
        signal.addEventListener("abort", () => r(), { once: true })
      })
    }
    const storyId = nextStoryId()
    const runId = launch(storyId)
    const sub = attach(storyId, runId)
    await until(() => sub.events.some((e) => e.type === "text"))

    live.stopRun(storyId, "a-run-that-already-settled")
    const run = live.findRun(storyId, runId)
    expect(run?.upstream.signal.aborted).toBe(false)

    live.stopRun(storyId, runId)
    const end = await sub.ended
    expect(end.status).toBe("aborted")
    expect(end.entryId).toBe("entry-1")
    expect(persists[0].text).toBe("Half a take")
  })

  test("a bare stop carrying another start's token cannot abort the active run", async () => {
    // Device A missed device B's run-started (hidden tab), pressed Send under
    // B's live run, then Stop before its own start returned a runId. Its bare
    // stop carries A's turnId — which is not the token B's run was started
    // with — so B's run must stream on untouched.
    script = async function* (signal) {
      yield { type: "text", value: "Another device's prose" }
      await new Promise<void>((r) => {
        if (signal.aborted) return r()
        signal.addEventListener("abort", () => r(), { once: true })
      })
    }
    const storyId = nextStoryId()
    const runId = launch(storyId, { turnId: "turn-B" })
    const sub = attach(storyId, runId)
    await until(() => sub.events.some((e) => e.type === "text"))

    live.stopRun(storyId, null, "turn-A")
    expect(live.findRun(storyId, runId)?.upstream.signal.aborted).toBe(false)

    // The run's own start can still stop it bare, by its own token.
    live.stopRun(storyId, null, "turn-B")
    const end = await sub.ended
    expect(end.status).toBe("aborted")
    expect(persists[0].text).toBe("Another device's prose")
  })

  test("a bare stop carrying another start's token cannot latch a reservation", async () => {
    script = async function* () {
      yield { type: "text", value: "Untouched." }
    }
    const storyId = nextStoryId()
    expect(live.reserveRun(storyId, "turn-B")).toBe(true)
    live.stopRun(storyId, null, "turn-A")
    const runId = launch(storyId, { turnId: "turn-B" })
    live.releaseRun(storyId)

    const sub = attach(storyId, runId)
    const end = await sub.ended
    expect(end.status).toBe("ok")
    expect(end.entryId).toBe("entry-1")
  })

  test("a stop during the reservation window aborts the run at birth", async () => {
    // Stop pressed while startGeneration is still between its reservation and
    // launchRun: there is no run to abort yet, so the intent latches against
    // the reservation and the launch consumes it — nothing streams, nothing
    // is billed, and the end is an ordinary Stop.
    script = async function* (signal) {
      if (signal.aborted) throw new Error("Request was aborted.")
      yield { type: "text", value: "Should never stream." }
    }
    const storyId = nextStoryId()
    expect(live.reserveRun(storyId)).toBe(true)
    live.stopRun(storyId)
    const runId = launch(storyId)
    live.releaseRun(storyId)

    const sub = attach(storyId, runId)
    const end = await sub.ended
    expect(end.status).toBe("aborted")
    expect(end.entryId).toBeNull()
    expect(end.error).toBeNull()
    expect(inserts).toHaveLength(0)
    expect(persists).toHaveLength(0)
  })

  test("releasing an unlaunched reservation clears its latched stop", async () => {
    // The start failed before launching anything; a latch outliving it would
    // abort the story's NEXT run at birth.
    script = async function* () {
      yield { type: "text", value: "Fresh run." }
    }
    const storyId = nextStoryId()
    expect(live.reserveRun(storyId)).toBe(true)
    live.stopRun(storyId)
    live.releaseRun(storyId)

    const sub = attach(storyId, launch(storyId))
    const end = await sub.ended
    expect(end.status).toBe("ok")
    expect(end.entryId).toBe("entry-1")
  })

  test("deleteStory takes the story's live run with it — aborted, nothing persisted, no toast", async () => {
    script = async function* (signal) {
      yield { type: "text", value: "Doomed prose" }
      await new Promise<void>((r) => {
        if (signal.aborted) return r()
        signal.addEventListener("abort", () => r(), { once: true })
      })
    }
    const storyId = nextStoryId()
    const sub = attach(storyId, launch(storyId))
    await until(() => sub.events.some((e) => e.type === "text"))

    const res = await deleteStory(storyId)
    expect(res.ok).toBe(true)

    const end = await sub.ended
    expect(end.status).toBe("aborted")
    expect(end.entryId).toBeNull()
    // NOT the "couldn't be saved" error: the prose is deliberately discarded
    // with its manuscript, never refused by a persist into a deleted story.
    expect(end.error).toBeNull()
    expect(persists).toHaveLength(0)
    // The call still settles — tokens were billed before the delete.
    expect(settles()[0].set.status).toBe("aborted")
    expect(live.isRunActive(storyId)).toBe(false)
  })

  test("a deleted story is tombstoned — a start racing the delete cannot reserve", async () => {
    // The start's POST was in flight when deleteStory ran: discardStoryRun
    // found neither a run nor a reservation, so without the tombstone the
    // start would reserve moments later and launch a run that streams and
    // bills into a story the delete already doomed.
    const storyId = nextStoryId()
    live.discardStoryRun(storyId)
    expect(live.reserveRun(storyId)).toBe(false)
  })

  test("a pre-first-byte failure was never billed and never persisted", async () => {
    script = async function* () {
      throw new Error("OpenRouter rejected the API key. Check Settings.")
    }
    const storyId = nextStoryId()
    const sub = attach(storyId, launch(storyId))

    const end = await sub.ended
    expect(end.status).toBe("error")
    expect(end.entryId).toBeNull()
    expect(end.error).toContain("rejected the API key")
    // No ledger row: a request that never reached a provider was never billed.
    expect(inserts).toHaveLength(0)
    expect(settles()).toHaveLength(0)
    expect(persists).toHaveLength(0)
  })

  test("a mid-stream failure keeps the prose and carries the message", async () => {
    script = async function* () {
      yield META
      yield { type: "text", value: "Kept." }
      throw new Error("The model provider is unavailable.")
    }
    const storyId = nextStoryId()
    const sub = attach(storyId, launch(storyId))

    const end = await sub.ended
    expect(end.status).toBe("error")
    expect(end.error).toContain("provider is unavailable")
    // The half-finished passage is worth more than tidiness about the ending.
    expect(end.entryId).toBe("entry-1")
    expect(persists[0].text).toBe("Kept.")
    expect(settles()[0].set.status).toBe("error")
  })

  test("one story, one run — and the slot frees when the run ends", async () => {
    const hold = gate()
    script = async function* () {
      await hold.opened
      yield { type: "text", value: "Done." }
    }
    const storyId = nextStoryId()
    const other = nextStoryId()
    const runId = launch(storyId)

    // The claim is the Map insert itself — two racing starts cannot both win.
    expect(
      live.launchRun({
        storyId,
        requestKind: "generate",
        userEntryId: null,
        removingEntryIds: [],
        turnId: null,
        context,
        settings: settings(),
        profileName: null,
      })
    ).toBeNull()
    expect(live.isRunActive(storyId)).toBe(true)

    // A different story is a different caret; it is not blocked.
    const otherRun = launch(other)

    hold.open()
    await until(() => live.findRun(storyId, runId)?.end)
    await until(() => live.findRun(other, otherRun)?.end)
    expect(live.isRunActive(storyId)).toBe(false)
    // The story is free again the moment its run finished.
    const again = launch(storyId)
    await until(() => live.findRun(storyId, again)?.end)
  })

  test("a finished run lingers with snapshot + end; a bare probe reads idle", async () => {
    script = async function* () {
      yield { type: "text", value: "Already over." }
    }
    const storyId = nextStoryId()
    const runId = launch(storyId)
    await until(() => live.findRun(storyId, runId)?.end)

    // Bare probe ("is anything running?"): no — a finished run must not make
    // a fresh page re-live an ending it never watched.
    expect(live.findRun(storyId)).toBeNull()

    // Named attach (told about this run, raced its finish): the whole story
    // in two frames.
    const sub = attach(storyId, runId)
    expect(sub.frame.text).toBe("Already over.")
    const end = await sub.ended
    expect(end.entryId).toBe("entry-1")
    // Buffered, not live — the run loop is long gone.
    expect(sub.buffered).not.toBeNull()
  })

  test("the bus hears run-started at launch and change before the end frame", async () => {
    script = async function* () {
      yield { type: "text", value: "Heard." }
    }
    const storyId = nextStoryId()
    const busEvents: Array<Record<string, unknown>> = []
    const unsubscribe = subscribeBus((event) => {
      busEvents.push({ ...event })
      if (event.kind === "change") order.push("change")
    })
    try {
      const runId = launch(storyId)
      // Published before the first token, so devices attach for the whole run.
      expect(busEvents[0]).toEqual({ kind: "run-started", storyId, runId })

      const sub = attach(storyId, runId)
      await sub.ended
      expect(busEvents).toContainEqual({ kind: "change", storyId })
      // Persist, then tell the other devices, then settle the origin.
      expect(order).toEqual(["persist", "change", "end"])
    } finally {
      unsubscribe()
    }
  })

  test("a refused persist ends the run as an error — streamed prose was lost, and silence would hide it", async () => {
    script = async function* () {
      yield { type: "text", value: "Orphaned take." }
    }
    persistOk = false
    const storyId = nextStoryId()
    const sub = attach(storyId, launch(storyId))
    const end = await sub.ended
    // NOT "ok": an ok/entryId-null frame is indistinguishable from a
    // legitimately empty completion, and the client would silently clear the
    // finished passage off every screen. The error carries the toast.
    expect(end.status).toBe("error")
    expect(end.entryId).toBeNull()
    expect(end.error).toContain("couldn't be saved")
  })

  test("with no key the run rides the offline mock and records no ledger row", async () => {
    currentKey = null
    const storyId = nextStoryId()
    // Few words → few chunks; the mock's real pacing is the point, not speed.
    const sub = attach(
      storyId,
      launch(storyId, { settings: settings({ maxTokens: 6 }) })
    )
    const end = await sub.ended

    expect(end.status).toBe("ok")
    expect(end.entryId).toBe("entry-1")
    expect(persists[0].text.length).toBeGreaterThan(0)
    // Nothing was billed and nothing claims otherwise.
    expect(inserts).toHaveLength(0)
    expect(settles()).toHaveLength(0)
    expect(end.usage?.costUsd).toBeNull()
  })
})

describe("MockGenerationProvider events", () => {
  const fast = { initialDelayMs: 0, chunkDelayMs: 0, reasoningDelayMs: 0 }

  async function run(thinking: ThinkingLevel) {
    const events: GenerationEvent[] = []
    for await (const event of new MockGenerationProvider(fast).generate({
      context,
      settings: settings({ thinking }),
    })) {
      events.push(event)
    }
    return events
  }

  test("meta comes first, and claims nothing it cannot back up", async () => {
    // The mock records no ledger row and was billed by nobody. Both ids are
    // null on purpose: a plausible-looking generation id here is one the
    // reconciler would happily go and ask OpenRouter about.
    const events = await run("off")
    expect(events[0]).toEqual({
      type: "meta",
      generationId: null,
      callId: null,
    })
  })

  test("the mock never invents a cost", async () => {
    const last = (await run("off")).at(-1)
    expect(last?.type).toBe("usage")
    if (last?.type !== "usage") throw new Error("unreachable")
    expect(last.usage.costUsd).toBeNull()
    expect(last.usage.isByok).toBeNull()
  })

  test("thinking off emits no reasoning events", async () => {
    const events = await run("off")
    expect(events.some((e) => e.type === "reasoning")).toBe(false)
  })

  test("a thinking level emits reasoning before any prose", async () => {
    const events = await run("medium")
    const firstText = events.findIndex((e) => e.type === "text")
    const reasoning = events.filter((e) => e.type === "reasoning")
    expect(reasoning).toHaveLength(14)
    // Everything before the first word is either the call's identity or the
    // model thinking — never prose arriving out of order.
    expect(
      events
        .slice(0, firstText)
        .every((e) => e.type === "reasoning" || e.type === "meta")
    ).toBe(true)
  })

  test("higher levels think longer", async () => {
    const low = (await run("low")).filter((e) => e.type === "reasoning").length
    const max = (await run("max")).filter((e) => e.type === "reasoning").length
    expect(max).toBeGreaterThan(low)
  })

  test("usage lands last, and counts the reasoning it reported", async () => {
    const events = await run("low")
    const last = events[events.length - 1]
    expect(last.type).toBe("usage")
    if (last.type !== "usage") throw new Error("unreachable")

    const chars = events.reduce(
      (sum, e) => (e.type === "reasoning" ? sum + e.chars : sum),
      0
    )
    expect(last.usage.reasoningTokens).toBe(Math.ceil(chars / 4))
    expect(last.usage.promptTokens).toBe(context.approxTokens)
    expect(last.usage.completionTokens).toBeGreaterThan(0)
  })

  test("the same seed produces the same run", async () => {
    expect(await run("medium")).toEqual(await run("medium"))
  })
})
