// lib/mcp/tools/test-mocks.ts — shared test doubles for the three write tools
// (write.test.ts, edit.test.ts, rewind.test.ts).
//
// They share a module because they share a boundary: all three call a service
// in lib/services/entries.ts and read the manuscript through lib/db/queries.
// The service itself runs for real over the fake db, so a spec asserts the
// statements it ran and the bus events it published, never a mocked call.
//
// `installMocks()` is called by each consuming file rather than run here on
// import, because it must land before that file's own `await import` of the
// tool under test.
import { mock } from "bun:test"

import { installQueryMocks, stubQueries } from "@/lib/mcp/tools/test-queries"
import { installEntriesDoubles } from "@/lib/services/entries-test-support"
import type { FakeDb } from "@/lib/services/test-support"

/* -------------------------------------------------------------------------- */
/* lib/db/queries — the position reads edit.ts and rewind.ts share            */
/* -------------------------------------------------------------------------- */

export const getLivePassageAtPosition = mock(
  async (
    _storyId: string,
    _position: number
  ): Promise<{ id: string; text: string } | null> => null
)
export const countLivePassagesAfter = mock(
  async (_storyId: string, _position: number): Promise<number> => 0
)

/** Back to defaults: no passage anywhere, nothing after it, an empty db. */
export function resetActionMocks(db: FakeDb) {
  // In beforeEach, not on import: the query double is shared with every other
  // spec in this directory, and bun collects them all before running a test.
  stubQueries({ getLivePassageAtPosition, countLivePassagesAfter })
  db.reset()
  getLivePassageAtPosition.mockClear()
  countLivePassagesAfter.mockClear()
  getLivePassageAtPosition.mockImplementation(async () => null)
  countLivePassagesAfter.mockImplementation(async () => 0)
}

/**
 * Installs the fake db the real entries service runs over, and points
 * "@/lib/db/queries" at the shared double. Call it at the top of each
 * consuming file, immediately before that file's import of the tool module.
 */
export async function installMocks(): Promise<FakeDb> {
  const db = await installEntriesDoubles()
  installQueryMocks()
  return db
}
