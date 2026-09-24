// lib/services/test-support.ts — The doubles every service spec shares.
//
// Services talk to drizzle directly, so the double is the drizzle chain itself:
// any chain off the fake db records its calls and, when awaited, resolves to
// the next scripted result. The sync bus stays REAL — a spec subscribes to it
// and asserts on the exact events a write publishes, which is the only proof
// a service still feeds magic sync.
//
// `mock.module` is process-global in bun, so each module is registered with a
// complete shape and behavior lives behind it in mutable state.
import { mock } from "bun:test"

import type { BusEvent } from "@/lib/sync/bus"

export interface ChainCall {
  method: string
  args: unknown[]
}

/** One drizzle statement: the root it started from and every call after it. */
export interface Statement {
  root: string
  calls: ChainCall[]
}

export interface FakeDb {
  /** Script the result the next awaited statement resolves to. */
  next(result: unknown): void
  /** Every statement awaited so far, in order. */
  statements: Statement[]
  /** The first call named `method` in statement `index`, if any. */
  argsOf(index: number, method: string): unknown[] | undefined
  revalidated: string[]
  reset(): void
}

// A chain is a callable Proxy, so `db.query.stories.findFirst(...)` and
// `db.insert(t).values(v).returning()` both walk it without a per-method table.
function makeChain(root: string, state: FakeState): unknown {
  const statement: Statement = { root, calls: [] }
  let settled: Promise<unknown> | null = null
  const settle = () => {
    if (settled === null) {
      state.statements.push(statement)
      settled = Promise.resolve(
        state.results.length > 0 ? state.results.shift() : []
      )
    }
    return settled
  }
  const chain: unknown = new Proxy(function () {}, {
    get(_target, prop) {
      if (prop === "then") {
        return (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
          settle().then(resolve, reject)
      }
      statement.calls.push({ method: String(prop), args: [] })
      return chain
    },
    apply(_target, _this, args: unknown[]) {
      const last = statement.calls[statement.calls.length - 1]
      if (last) last.args = args
      return chain
    },
  })
  return chain
}

interface FakeState {
  results: unknown[]
  statements: Statement[]
}

const state: FakeState = { results: [], statements: [] }
const revalidated: string[] = []

const db: unknown = new Proxy(
  {},
  {
    get(_target, prop) {
      if (prop === "then") return undefined
      if (prop === "transaction") {
        return async (fn: (tx: unknown) => Promise<unknown>) => fn(db)
      }
      return makeChain(String(prop), state)
    },
  }
)

const fakeDb: FakeDb = {
  next: (result) => state.results.push(result),
  statements: state.statements,
  argsOf: (index, method) =>
    state.statements[index]?.calls.find((call) => call.method === method)?.args,
  revalidated,
  reset() {
    state.results.length = 0
    state.statements.length = 0
    revalidated.length = 0
  },
}

/**
 * Registers "@/lib/db/client", "next/cache" and "server-only". Call it at the
 * top of a spec BEFORE importing the service under test. Every call registers
 * again over the same state, so a spec that runs after another file doubled
 * these specifiers still gets this one.
 */
export function installFakeDb(): FakeDb {
  mock.module("server-only", () => ({}))
  mock.module("@/lib/db/client", () => ({
    getDb: async () => db,
    closeDb: async () => {},
  }))
  mock.module("next/cache", () => ({
    revalidatePath: (path: string) => {
      revalidated.push(path)
    },
  }))
  return fakeDb
}

/** Collect bus events until the returned `stop` is called. */
export async function captureBus(): Promise<{
  events: BusEvent[]
  stop: () => void
}> {
  const { subscribeBus } = await import("@/lib/sync/bus")
  const events: BusEvent[] = []
  const stop = subscribeBus((event) => {
    events.push(event)
  })
  return { events, stop }
}
