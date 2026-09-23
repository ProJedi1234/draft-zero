// lib/mcp/tools/test-queries.ts — one double for "@/lib/db/queries", shared by
// every MCP tool spec.
//
// It exists because `mock.module` replaces a specifier for the whole test
// PROCESS, not for the file that called it. Nine specs in this directory need
// a different subset of the read layer, and when each registered its own
// partial object the last registration won: a spec that had already bound
// `getUsageAggregate` found it gone, and bun reported it as
// `SyntaxError: Export named 'getUsageAggregate' not found` from a file that
// does export it.
//
// So the registered module has ONE fixed, complete shape — every read any tool
// imports — and behavior lives in a mutable table behind it. Registering twice
// is a no-op because both registrations hand back the same object, and a spec
// picks its own doubles by name with `stubQueries` (from `beforeEach`, so its
// choices outlive another file's collection).
import { mock } from "bun:test"
import { readFileSync } from "node:fs"

import type * as Queries from "@/lib/db/queries"

/**
 * Loose on purpose: a double stands in for reads whose real return types range
 * from a number to a full Story, and every spec supplies its own fixture.
 */
type Stub = (...args: never[]) => unknown

const EMPTY_USAGE = {
  groups: [],
  totals: {
    calls: 0,
    costUsd: "0",
    promptTokens: 0,
    completionTokens: 0,
    reasoningTokens: 0,
    cachedPromptTokens: 0,
  },
}

/**
 * Reads the MCP tools make, with a default that answers "nothing there" — a
 * spec overrides only the reads its tool actually makes. Every other export
 * gets a stub that throws when called (see {@link queryNames}).
 */
const DEFAULTS = {
  countLivePassages: async () => 0,
  countLivePassagesAfter: async () => 0,
  countLivePassagesByStory: async () => new Map<string, number>(),
  escapeLikeNeedle: (query: string) => query.trim().replace(/[\\%_]/g, "\\$&"),
  getLivePassageAtPosition: async () => null,
  getLorebookEntry: async () => null,
  getManuscriptBounds: async () => ({ first: 0, last: -1, empty: true }),
  getStory: async () => null,
  getStoryFull: async () => null,
  getStoryTitle: async () => null,
  getUsageAggregate: async () => EMPTY_USAGE,
  listLorebookEntries: async () => [],
  listStoriesWithCounts: async () => [],
  readManuscriptWindow: async () => [],
  resolveStoryRecap: async () => null,
  searchLorebookContent: async () => [],
  searchStoryEntries: async () => [],
} satisfies Partial<Record<QueryName, Stub>>

type QueryName = keyof typeof Queries

/**
 * Every runtime export of the real module, read from its source. The shape has
 * to be complete because the tools reach services, and services import reads
 * no MCP spec ever stubs: one missing name is a SyntaxError for every spec in
 * the process.
 */
const SOURCE = readFileSync(
  new URL("../../db/queries.ts", import.meta.url),
  "utf8"
)

function queryNames(): QueryName[] {
  const names = SOURCE.matchAll(
    /^export (?:async function|function|const|let) (\w+)/gm
  )
  return [...new Set([...names].map((match) => match[1] as QueryName))]
}

/**
 * Literal constants keep their real value: a page size forwarded as a function
 * would reach the query as `limit`. Only number and string literals exist.
 */
function literalConstants(): Map<QueryName, unknown> {
  const found = SOURCE.matchAll(
    /^export const (\w+) = (-?\d+(?:\.\d+)?|"[^"\n]*")$/gm
  )
  return new Map(
    [...found].map((match) => [match[1] as QueryName, JSON.parse(match[2])])
  )
}

function unstubbed(name: string): Stub {
  return () => {
    throw new Error(`${name} is not stubbed. Pass it to stubQueries.`)
  }
}

const LITERALS = literalConstants()
const NAMES = queryNames().filter((name) => !LITERALS.has(name))
const BASE: Record<QueryName, Stub> = Object.fromEntries(
  NAMES.map((name) => [
    name,
    DEFAULTS[name as keyof typeof DEFAULTS] ?? unstubbed(name),
  ])
) as Record<QueryName, Stub>

/** What each name currently does. Swap entries through {@link stubQueries}. */
const behavior: Record<QueryName, Stub> = { ...BASE }

/**
 * The registered module. Its keys never change; each one forwards to whatever
 * `behavior` holds at CALL time, which is what lets a spec choose its doubles
 * after this module was already registered and imported.
 */
const queriesModule = {
  ...Object.fromEntries(LITERALS),
  ...Object.fromEntries(
    NAMES.map((name) => [
      name,
      // The forwarder takes real arguments; `Stub`'s `never[]` is what makes
      // any concrete double assignable to the table in the first place.
      (...args: unknown[]) =>
        (behavior[name] as (...forwarded: unknown[]) => unknown)(...args),
    ])
  ),
}

/**
 * Points the named reads at this spec's doubles and every other read back at
 * its default. Call it from `beforeEach`, not module scope: bun collects every
 * spec's top level before running any test, so a module-scope call would be
 * overwritten by the next file collected.
 */
export function stubQueries(overrides: Partial<Record<QueryName, Stub>>): void {
  Object.assign(behavior, BASE, overrides)
}

/** Registers the double. Safe to call from more than one spec. */
export function installQueryMocks(): void {
  mock.module("@/lib/db/queries", () => queriesModule)
}
