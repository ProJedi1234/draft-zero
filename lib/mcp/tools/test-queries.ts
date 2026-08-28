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

/**
 * Loose on purpose: a double stands in for reads whose real return types range
 * from a number to a full Story, and every spec supplies its own fixture.
 */
type Stub = (...args: never[]) => unknown

/**
 * Every export of `@/lib/db/queries` that a `lib/mcp/tools/*.ts` module
 * imports, with a default that answers "nothing there" — a spec overrides only
 * the reads its tool actually makes. Add a name here when a tool starts
 * importing one, or that tool's spec will register a shape missing it.
 */
const DEFAULTS = {
  countLivePassagesAfter: async () => 0,
  countLivePassagesByStory: async () => new Map<string, number>(),
  escapeLikeNeedle: (query: string) => query.trim().replace(/[\\%_]/g, "\\$&"),
  getLivePassageAtPosition: async () => null,
  getManuscriptBounds: async () => ({ first: 0, last: -1, empty: true }),
  getStory: async () => null,
  getStoryTitle: async () => null,
  listLorebookEntries: async () => [],
  listStoriesWithCounts: async () => [],
  readManuscriptWindow: async () => [],
  searchLorebookContent: async () => [],
  searchStoryEntries: async () => [],
} satisfies Record<string, Stub>

type QueryName = keyof typeof DEFAULTS

/** What each name currently does. Swap entries through {@link stubQueries}. */
const behavior: Record<QueryName, Stub> = { ...DEFAULTS }

/**
 * The registered module. Its keys never change; each one forwards to whatever
 * `behavior` holds at CALL time, which is what lets a spec choose its doubles
 * after this module was already registered and imported.
 */
const queriesModule = Object.fromEntries(
  (Object.keys(DEFAULTS) as QueryName[]).map((name) => [
    name,
    // The forwarder takes real arguments; `Stub`'s `never[]` is what makes any
    // concrete double assignable to the table in the first place.
    (...args: unknown[]) =>
      (behavior[name] as (...forwarded: unknown[]) => unknown)(...args),
  ])
)

/**
 * Points the named reads at this spec's doubles and every other read back at
 * its default. Call it from `beforeEach`, not module scope: bun collects every
 * spec's top level before running any test, so a module-scope call would be
 * overwritten by the next file collected.
 */
export function stubQueries(overrides: Partial<Record<QueryName, Stub>>): void {
  Object.assign(behavior, DEFAULTS, overrides)
}

/** Registers the double. Safe to call from more than one spec. */
export function installQueryMocks(): void {
  mock.module("@/lib/db/queries", () => queriesModule)
}
