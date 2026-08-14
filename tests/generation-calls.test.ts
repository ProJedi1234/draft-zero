// tests/generation-calls.test.ts — The spend ledger's write half: what
// lib/generation/calls.ts and lib/generation/reconcile.ts actually put in the
// row, and what they refuse to put there. Their caller is the run loop in
// lib/generation/live.ts now (the /api/generate route is gone); when and
// whether the loop calls them is pinned in generation-stream.test.ts.
//
// This layer has no UI and no return value. Every one of its mistakes is
// silent — a wrong number that sums into a total a writer trusts, or an
// exception thrown up the generation path that costs someone a paragraph — so
// the assertions here are about the statements themselves rather than about
// anything observable from the app.
//
// Three invariants carry the feature and are pinned individually:
//
// 1. NULL is not zero. An unmeasured call must leave cost_usd NULL. A zero
//    would sum silently and would be indistinguishable from a genuinely free
//    call.
// 2. Nothing throws into generation. Every export swallows its own failures;
//    losing the measurement is a bookkeeping problem, losing the prose is not.
// 3. A reconciled figure outranks a streamed one and is never downgraded.
//
// The database is faked, not connected. The suite has no DB harness (see
// tests/history-ops.test.ts, which asserts write plans against an in-memory
// store for the same reason), and the dev Postgres is shared — so the fake
// records the drizzle builder calls and the WHERE clauses are rendered to SQL
// with PgDialect, which is the same text the real driver would send.

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { SQL as SQLClass, type SQL } from "drizzle-orm"
import { PgDialect } from "drizzle-orm/pg-core"

import type { GenerationEvent, GenerationUsage } from "@/lib/generation/types"

// `server-only` throws on import outside a React Server Component graph, and
// both modules under test import it on purpose. Neutralising the marker is the
// only way to unit-test a server module at all.
mock.module("server-only", () => ({}))

interface UpdateCall {
  set: Record<string, unknown>
  where: SQL | undefined
}

const inserts: Record<string, unknown>[] = []
const updates: UpdateCall[] = []
/** Set to make the fake database fail the way a dead pool would. */
let dbFails = false

const fakeDb = {
  insert() {
    return {
      async values(values: Record<string, unknown>) {
        if (dbFails) throw new Error("connection terminated unexpectedly")
        inserts.push(values)
      },
    }
  },
  update() {
    const call: UpdateCall = { set: {}, where: undefined }
    const builder = {
      set(values: Record<string, unknown>) {
        call.set = values
        return builder
      },
      where(condition: SQL) {
        call.where = condition
        if (dbFails) return Promise.reject(new Error("connection terminated"))
        updates.push(call)
        return Promise.resolve()
      },
    }
    return builder
  },
}

mock.module("@/lib/db/client", () => ({
  getDb: async () => fakeDb,
}))

const { recordCallStarted, settleCall, sweepStuckCalls } =
  await import("@/lib/generation/calls")
const { reconcileCall, shouldReconcile } =
  await import("@/lib/generation/reconcile")

const dialect = new PgDialect()

/** The WHERE clause as the driver would send it. */
function renderWhere(call: UpdateCall) {
  if (!call.where) throw new Error("statement had no WHERE — that is the bug")
  return dialect.sqlToQuery(call.where)
}

/**
 * The value a settle statement actually binds for a measurement column.
 *
 * Those columns are not plain values: each is a `case when cost_source =
 * 'reconciled' then <column> else $1 end`, so that a settle landing after a
 * reconciliation cannot overwrite OpenRouter's own accounting (see `keep` in
 * lib/generation/calls.ts). The bound parameter is the value the settle would
 * write to a row that has NOT been reconciled, which is what these tests are
 * about; `guardsReconciled` covers the other arm.
 */
function settleValue(call: UpdateCall, key: string): unknown {
  const expr = call.set[key]
  if (!(expr instanceof SQLClass)) return expr
  const { params } = dialect.sqlToQuery(expr)
  if (params.length !== 1) {
    throw new Error(`expected one bound value for ${key}, got ${params.length}`)
  }
  return params[0]
}

/** Whether a settle column defers to an already-reconciled row. */
function guardsReconciled(call: UpdateCall, key: string): boolean {
  const expr = call.set[key]
  if (!(expr instanceof SQLClass)) return false
  return dialect
    .sqlToQuery(expr)
    .sql.includes(`"cost_source" = 'reconciled' then`)
}

// The sweep runs fire-and-forget inside recordCallStarted, so its statement can
// land in the same list as the one under test. It is told apart by shape rather
// than by status: an errored settle is also status "error", and conflating the
// two would quietly hide the settle path's own error case.
function isSweep(call: UpdateCall) {
  return !("costUsd" in call.set)
}
function sweepUpdates() {
  return updates.filter(isSweep)
}
function settleUpdates() {
  return updates.filter((u) => !isSweep(u))
}

const START = {
  id: "call-1",
  storyId: "story-1",
  origStoryId: "story-1",
  storyTitle: "The Long Thaw",
  requestKind: "continue" as const,
  modelId: "anthropic/claude-sonnet-4",
  thinking: "medium" as const,
  providerName: "Anthropic",
}

const USAGE: GenerationUsage = {
  promptTokens: 4210,
  completionTokens: 318,
  reasoningTokens: 96,
  costUsd: 0.000123456789,
  cachedPromptTokens: 3800,
  upstreamPromptCostUsd: 0.0001,
  upstreamCompletionCostUsd: 0.00002,
  isByok: false,
}

const realFetch = globalThis.fetch
const realSetTimeout = globalThis.setTimeout
/** Every delay the code under test asked to wait, in order. */
let waited: number[] = []

beforeEach(() => {
  inserts.length = 0
  updates.length = 0
  dbFails = false
  waited = []
  // The reconciler backs off across ~15 seconds by design. Collapsing the
  // waits keeps the schedule assertable without making the suite sit through
  // it — the delays are recorded rather than served.
  globalThis.setTimeout = ((fn: () => void, ms?: number) => {
    waited.push(ms ?? 0)
    return realSetTimeout(fn, 0)
  }) as unknown as typeof setTimeout
})

afterEach(() => {
  globalThis.setTimeout = realSetTimeout
  globalThis.fetch = realFetch
})

describe("recordCallStarted", () => {
  test("opens the row as streaming, created and unsettled", async () => {
    await recordCallStarted(START)

    expect(inserts).toHaveLength(1)
    const row = inserts[0]
    expect(row.id).toBe("call-1")
    expect(row.status).toBe("streaming")
    // Not "settled_at is null" by omission of intent — the column must simply
    // never be given a value here, or a crashed stream looks finished.
    expect(row.settledAt).toBeUndefined()
    expect(typeof row.createdAt).toBe("string")
    expect(Number.isNaN(Date.parse(row.createdAt as string))).toBe(false)
  })

  test("carries the provenance the row has to survive on", async () => {
    await recordCallStarted(START)

    const row = inserts[0]
    expect(row.storyId).toBe("story-1")
    // Denormalised on purpose: the row outlives the story it belongs to.
    expect(row.storyTitle).toBe("The Long Thaw")
    expect(row.requestKind).toBe("continue")
    expect(row.modelId).toBe("anthropic/claude-sonnet-4")
    expect(row.thinking).toBe("medium")
    expect(row.providerName).toBe("Anthropic")
    // Claimed later, by the write that persists the passage — never here.
    expect(row.storyEntryId).toBeNull()
  })

  test("a call whose story is gone is still a call", async () => {
    await recordCallStarted({ ...START, storyId: null, storyTitle: null })
    expect(inserts[0].storyId).toBeNull()
    // The FK-free copy keeps the id the request named even though the FK
    // column cannot — this is the grouping key that outlives the story.
    expect(inserts[0].origStoryId).toBe("story-1")
    expect(inserts[0].status).toBe("streaming")
  })

  test("a dead database does not reach the writer", async () => {
    dbFails = true
    // The contract that matters most in this file: no rejection, ever.
    expect(recordCallStarted(START)).resolves.toBeUndefined()
  })
})

describe("settleCall", () => {
  test("a completed call writes a decimal cost at the column's full scale", async () => {
    await settleCall("call-1", {
      status: "ok",
      generationId: "gen-abc",
      usage: USAGE,
    })

    const [call] = settleUpdates()
    expect(call.set.status).toBe("ok")
    expect(call.set.openrouterGenerationId).toBe("gen-abc")
    // A string, at scale 12 — the float boundary is crossed exactly here and
    // never again, so every sum downstream happens in Postgres.
    expect(settleValue(call, "costUsd")).toBe("0.000123456789")
    expect(typeof settleValue(call, "costUsd")).toBe("string")
    expect(settleValue(call, "costSource")).toBe("stream")
    expect(typeof call.set.settledAt).toBe("string")
    expect(Number.isNaN(Date.parse(call.set.settledAt as string))).toBe(false)
  })

  test("token counts and the upstream split ride along", async () => {
    await settleCall("call-1", {
      status: "ok",
      generationId: "gen-abc",
      usage: USAGE,
    })

    const [call] = settleUpdates()
    expect(settleValue(call, "promptTokens")).toBe(4210)
    expect(settleValue(call, "completionTokens")).toBe(318)
    expect(settleValue(call, "reasoningTokens")).toBe(96)
    expect(settleValue(call, "cachedPromptTokens")).toBe(3800)
    expect(settleValue(call, "upstreamPromptCostUsd")).toBe("0.000100000000")
    expect(settleValue(call, "upstreamCompletionCostUsd")).toBe(
      "0.000020000000"
    )
    expect(settleValue(call, "isByok")).toBe(false)
  })

  test("it settles exactly the one row, by id", async () => {
    await settleCall("call-1", {
      status: "ok",
      generationId: null,
      usage: USAGE,
    })
    const { sql, params } = renderWhere(settleUpdates()[0])
    expect(sql).toBe('"generation_calls"."id" = $1')
    expect(params).toEqual(["call-1"])
  })

  test("an aborted call leaves the cost NULL — never a zero", async () => {
    // Usage rides the final chunk and only the final chunk, so a stopped
    // generation has no usage at all while OpenRouter has still billed it.
    // Writing 0 here would silently under-report every Stop a writer makes.
    await settleCall("call-1", {
      status: "aborted",
      generationId: "gen-abc",
      usage: null,
    })

    const [call] = settleUpdates()
    expect(call.set.status).toBe("aborted")
    expect(settleValue(call, "costUsd")).toBeNull()
    expect(settleValue(call, "costUsd")).not.toBe("0.000000000000")
    expect(settleValue(call, "costUsd")).not.toBe(0)
    expect(settleValue(call, "costSource")).toBeNull()
    expect(settleValue(call, "promptTokens")).toBeNull()
    expect(settleValue(call, "completionTokens")).toBeNull()
    // The handle reconciliation will need, kept even though nothing else is.
    expect(call.set.openrouterGenerationId).toBe("gen-abc")
    expect(typeof call.set.settledAt).toBe("string")
  })

  test("a provider error settles as an error, priced only if it was priced", async () => {
    await settleCall("call-1", {
      status: "error",
      generationId: null,
      usage: null,
    })
    const [call] = settleUpdates()
    expect(call.set.status).toBe("error")
    expect(settleValue(call, "costUsd")).toBeNull()
  })

  test("usage without a price is still usage", async () => {
    // OpenRouter reports tokens but declines to price BYOK traffic. Counts are
    // known, cost is not, and the two must not be conflated.
    await settleCall("call-1", {
      status: "ok",
      generationId: "gen-abc",
      usage: { ...USAGE, costUsd: null, isByok: true },
    })
    const [call] = settleUpdates()
    expect(settleValue(call, "promptTokens")).toBe(4210)
    expect(settleValue(call, "costUsd")).toBeNull()
    expect(settleValue(call, "costSource")).toBeNull()
    expect(settleValue(call, "isByok")).toBe(true)
  })

  test("it cannot downgrade a row reconciliation already priced", async () => {
    // The run loop awaits the settle but fires the reconciliation and
    // forgets it. Reconciliation sleeps first, so settle wins in practice —
    // but the losing order is the destructive one: an aborted call settles with
    // no usage, so an unguarded settle arriving second would overwrite
    // OpenRouter's own figure with NULL. Every measurement column defers.
    await settleCall("call-1", {
      status: "aborted",
      generationId: "gen-abc",
      usage: null,
    })
    const [call] = settleUpdates()

    for (const key of [
      "costUsd",
      "costSource",
      "promptTokens",
      "completionTokens",
      "reasoningTokens",
      "cachedPromptTokens",
      "upstreamPromptCostUsd",
      "upstreamCompletionCostUsd",
      "isByok",
    ]) {
      expect(guardsReconciled(call, key)).toBe(true)
    }

    // Lifecycle columns deliberately do NOT defer. Every aggregate excludes
    // status 'streaming', so a row that never left it is a cost that exists and
    // cannot be seen — strictly worse than one written twice.
    expect(guardsReconciled(call, "status")).toBe(false)
    expect(guardsReconciled(call, "settledAt")).toBe(false)
    expect(call.set.status).toBe("aborted")
  })

  test("a dead database does not reach the writer", async () => {
    dbFails = true
    expect(
      settleCall("call-1", { status: "ok", generationId: null, usage: USAGE })
    ).resolves.toBeUndefined()
  })
})

describe("sweepStuckCalls", () => {
  test("flips only streaming rows older than the threshold, and nothing else", async () => {
    await sweepStuckCalls()

    const [call] = sweepUpdates()
    expect(call.set.status).toBe("error")
    expect(typeof call.set.settledAt).toBe("string")
    // The whole statement: it must not touch a cost, a token count, or a
    // status that is already settled.
    expect(Object.keys(call.set).sort()).toEqual(["settledAt", "status"])

    const { sql, params } = renderWhere(call)
    expect(sql).toBe(
      '("generation_calls"."status" = $1 and "generation_calls"."created_at" < $2)'
    )
    expect(params[0]).toBe("streaming")

    // Ten minutes back, well past any real generation and well short of a
    // writing session, so nothing in flight is ever swept.
    const cutoff = Date.parse(params[1] as string)
    const ago = Date.now() - cutoff
    expect(ago).toBeGreaterThanOrEqual(10 * 60 * 1000)
    expect(ago).toBeLessThan(11 * 60 * 1000)
  })

  test("opening a row sweeps, but never blocks on the sweep", async () => {
    await recordCallStarted(START)
    // Fire-and-forget: it may land a tick late, which is the point.
    await Promise.resolve()
    await Promise.resolve()
    expect(sweepUpdates().length).toBeGreaterThan(0)
    expect(inserts).toHaveLength(1)
  })

  test("a dead database does not reach the writer", async () => {
    dbFails = true
    expect(sweepStuckCalls()).resolves.toBeUndefined()
  })
})

describe("reconcileCall", () => {
  /** Answers /generation with this sequence, one entry per attempt. */
  function respondWith(
    steps: Array<{ status: number; body?: unknown } | "reject">
  ) {
    const seen: string[] = []
    let i = 0
    globalThis.fetch = (async (url: string) => {
      seen.push(String(url))
      const step = steps[Math.min(i++, steps.length - 1)]
      if (step === "reject") throw new Error("ECONNRESET")
      if (step.body === undefined)
        return new Response(null, { status: step.status })
      return Response.json(step.body, { status: step.status })
    }) as unknown as typeof fetch
    return seen
  }

  const RECORD = {
    total_cost: 0.004237,
    native_tokens_prompt: 4210,
    native_tokens_completion: 318,
    native_tokens_reasoning: 96,
    provider_name: "Anthropic",
    is_byok: false,
  }

  test("a record on the first ask writes a reconciled cost", async () => {
    const seen = respondWith([{ status: 200, body: { data: RECORD } }])
    await reconcileCall("call-1", "gen-abc", "sk-or-test")

    expect(seen).toHaveLength(1)
    expect(seen[0]).toContain("id=gen-abc")

    const [call] = updates
    expect(call.set.costUsd).toBe("0.004237000000")
    expect(call.set.costSource).toBe("reconciled")
    expect(call.set.promptTokens).toBe(4210)
    expect(call.set.completionTokens).toBe(318)
    expect(call.set.reasoningTokens).toBe(96)
    // The endpoint that actually served it — unknowable from the stream on an
    // Auto-routed call, which is half the reason this lookup exists.
    expect(call.set.providerName).toBe("Anthropic")
  })

  test("404 is 'not written yet', and the backoff is 1s / 4s / 10s", async () => {
    // OpenRouter writes the record a beat after the stream dies. Asking
    // immediately always 404s, so a non-retrying reconciler would measure
    // nothing at all.
    const seen = respondWith([
      { status: 404 },
      { status: 404 },
      { status: 200, body: { data: RECORD } },
    ])
    await reconcileCall("call-1", "gen-abc", "sk-or-test")

    expect(seen).toHaveLength(3)
    expect(waited).toEqual([1_000, 4_000, 10_000])
    expect(updates[0].set.costSource).toBe("reconciled")
  })

  test("giving up leaves the cost NULL rather than writing a guess", async () => {
    const seen = respondWith([{ status: 404 }])
    await reconcileCall("call-1", "gen-abc", "sk-or-test")

    expect(seen).toHaveLength(3)
    expect(waited).toEqual([1_000, 4_000, 10_000])
    // No statement at all: the row keeps whatever it had, which is NULL.
    expect(updates).toHaveLength(0)
  })

  test("a rejecting fetch is survived, not propagated", async () => {
    respondWith(["reject"])
    // after() has no one to hand a rejection to; the response is long sent.
    expect(reconcileCall("call-1", "gen-abc", "sk-or-test")).resolves.toBe(
      undefined
    )
    await reconcileCall("call-1", "gen-abc", "sk-or-test")
    expect(updates).toHaveLength(0)
  })

  test("a non-404 failure stops immediately — retrying a 401 buys nothing", async () => {
    const seen = respondWith([{ status: 401, body: { error: "no" } }])
    await reconcileCall("call-1", "gen-abc", "sk-or-test")
    expect(seen).toHaveLength(1)
    expect(updates).toHaveLength(0)
  })

  test("a record OpenRouter declined to price never erases a cost already known", async () => {
    // The destructive case this guards: a stop whose final chunk landed a beat
    // before it is settled 'aborted' WITH a streamed cost, and is then
    // reconciled anyway. A payload without a price must leave that figure — and
    // its cost_source — exactly where they were rather than writing NULL over
    // OpenRouter's own accounting.
    respondWith([
      { status: 200, body: { data: { ...RECORD, total_cost: null } } },
    ])
    await reconcileCall("call-1", "gen-abc", "sk-or-test")
    expect(updates[0].set).not.toHaveProperty("costUsd")
    expect(updates[0].set).not.toHaveProperty("costSource")
    // What the record DID carry is still written.
    expect(updates[0].set.promptTokens).toBe(4210)
  })

  test("fields the record omits are left alone, not nulled", async () => {
    // provider_name is the sharp one: recordCallStarted pins the story's
    // routing tag on the row, and a record without one would otherwise erase it.
    respondWith([
      {
        status: 200,
        body: {
          data: {
            total_cost: 0.004237,
            provider_name: null,
            is_byok: null,
            native_tokens_prompt: null,
            native_tokens_completion: null,
            native_tokens_reasoning: null,
          },
        },
      },
    ])
    await reconcileCall("call-1", "gen-abc", "sk-or-test")

    const [call] = updates
    expect(call.set.costUsd).toBe("0.004237000000")
    expect(call.set.costSource).toBe("reconciled")
    for (const key of [
      "providerName",
      "isByok",
      "promptTokens",
      "completionTokens",
      "reasoningTokens",
    ]) {
      expect(call.set).not.toHaveProperty(key)
    }
  })

  test("a record that says nothing at all writes no statement", async () => {
    respondWith([{ status: 200, body: { data: {} } }])
    await reconcileCall("call-1", "gen-abc", "sk-or-test")
    expect(updates).toHaveLength(0)
  })

  test("a reconciled row is never downgraded by a second reconciliation", async () => {
    respondWith([{ status: 200, body: { data: RECORD } }])
    await reconcileCall("call-1", "gen-abc", "sk-or-test")

    const { sql, params } = renderWhere(updates[0])
    expect(sql).toBe(
      '"generation_calls"."id" = $1 and ("generation_calls"."cost_source" is distinct from \'reconciled\')'
    )
    expect(params).toEqual(["call-1"])
  })

  test("the bearer token goes in the header and never in the URL", async () => {
    let headers: Headers | undefined
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      headers = new Headers(init?.headers)
      return Response.json({ data: RECORD })
    }) as unknown as typeof fetch

    await reconcileCall("call-1", "gen-abc", "sk-or-secret")
    expect(headers?.get("authorization")).toBe("Bearer sk-or-secret")
  })

  test("a dead database does not turn a lookup into an exception", async () => {
    respondWith([{ status: 200, body: { data: RECORD } }])
    dbFails = true
    expect(reconcileCall("call-1", "gen-abc", "sk-or-test")).resolves.toBe(
      undefined
    )
  })
})

describe("shouldReconcile", () => {
  test("a completed call is never asked about — its streamed cost is authoritative", () => {
    expect(shouldReconcile("ok", "gen-abc")).toBe(false)
  })

  test("a stopped or errored call with a handle is worth the round trip", () => {
    expect(shouldReconcile("aborted", "gen-abc")).toBe(true)
    expect(shouldReconcile("error", "gen-abc")).toBe(true)
  })

  test("without a generation id there is nothing to ask about", () => {
    expect(shouldReconcile("aborted", null)).toBe(false)
    expect(shouldReconcile("error", null)).toBe(false)
  })
})

describe("the meta event contract", () => {
  // Pinned here rather than in the stream suite because this is the shape the
  // ledger depends on: the run loop learns the generation id — the handle a
  // stopped call's cost hangs on — from this event and nowhere else.
  test("both ids are nullable, and the mock is allowed to claim neither", () => {
    const offline: GenerationEvent = {
      type: "meta",
      generationId: null,
      callId: null,
    }
    const live: GenerationEvent = {
      type: "meta",
      generationId: "gen-abc",
      callId: "call-1",
    }
    expect(offline).toEqual({ type: "meta", generationId: null, callId: null })
    expect(live.type).toBe("meta")
    if (live.type !== "meta") throw new Error("unreachable")
    // A non-null callId is the handle the persist core stamps onto the row.
    expect(live.callId).toBe("call-1")
    expect(live.generationId).toBe("gen-abc")
  })
})
