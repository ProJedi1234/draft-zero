// lib/services/entries-test-support.ts — The doubles every spec that runs the
// real entries service needs on top of installFakeDb.
//
// tests/generation-stream.test.ts and tests/provider-routing.test.ts double
// "@/lib/db/entry-writes" with cores that throw, and mock.module is
// process-global, so a spec that runs after them would get those throwers.
// The "?real" suffix loads a fresh copy of the true module, which is then put
// back under the shared specifier for the length of this spec.
import { mock } from "bun:test"

import { installFakeDb, type FakeDb } from "@/lib/services/test-support"

const REAL_ENTRY_WRITES = "@/lib/db/entry-writes.ts?real"

export async function installEntriesDoubles(): Promise<FakeDb> {
  const db = installFakeDb()
  const real = (await import(
    REAL_ENTRY_WRITES
  )) as typeof import("@/lib/db/entry-writes")
  mock.module("@/lib/db/entry-writes", () => ({ ...real }))
  // loadEntryContext reads the model catalog, which fetches from OpenRouter
  // whenever a key resolves; another spec's double may hand it one.
  mock.module("@/lib/generation/key", () => ({
    resolveOpenRouterKey: () => null,
  }))
  return db
}
