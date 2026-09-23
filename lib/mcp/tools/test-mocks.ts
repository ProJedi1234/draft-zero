// lib/mcp/tools/test-mocks.ts — shared test doubles for the three write tools
// (write.test.ts, edit.test.ts, rewind.test.ts).
//
// They share a module because they share a boundary: all three call a mutator
// in lib/actions/* and read the manuscript through lib/db/queries, and a
// double for either is worth writing once.
//
// `installMocks()` is called by each consuming file rather than run here on
// import, because it must land before that file's own `await import` of the
// tool under test — a module that binds `updateEntryText` at import time
// binds whatever the specifier resolved to at that moment.
import { mock } from "bun:test"

import { installQueryMocks, stubQueries } from "@/lib/mcp/tools/test-queries"
import { installFakeDb } from "@/lib/services/test-support"
import type { ActionResult, StoryEntry } from "@/lib/types"

/* -------------------------------------------------------------------------- */
/* lib/actions/entries                                                        */
/*                                                                            */
/* write.ts calls appendEntryOutsideRun from "@/lib/actions/entries" rather   */
/* than appendEntryCore from "@/lib/db/entry-writes" directly, which keeps it */
/* off a specifier tests/generation-stream.test.ts also doubles with a        */
/* different shape. See write.ts's file header.                              */
/* -------------------------------------------------------------------------- */

export const appendEntryOutsideRun = mock(
  async (
    _storyId: string,
    _mode: string,
    _text: string
  ): Promise<ActionResult<{ entry: StoryEntry }>> => ({
    ok: true,
    data: { entry: {} as StoryEntry },
  })
)
export const updateEntryText = mock(async (): Promise<ActionResult> => ({
  ok: true,
  data: null,
}))
export const rewindToEntry = mock(async (): Promise<ActionResult> => ({
  ok: true,
  data: null,
}))

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

/** Back to defaults: no passage anywhere, nothing after it, every write ok. */
export function resetActionMocks() {
  // In beforeEach, not on import: the query double is shared with every other
  // spec in this directory, and bun collects them all before running a test.
  stubQueries({ getLivePassageAtPosition, countLivePassagesAfter })
  appendEntryOutsideRun.mockClear()
  updateEntryText.mockClear()
  rewindToEntry.mockClear()
  getLivePassageAtPosition.mockClear()
  countLivePassagesAfter.mockClear()
  appendEntryOutsideRun.mockImplementation(async () => ({
    ok: true,
    data: { entry: {} as StoryEntry },
  }))
  updateEntryText.mockImplementation(async () => ({ ok: true, data: null }))
  rewindToEntry.mockImplementation(async () => ({ ok: true, data: null }))
  getLivePassageAtPosition.mockImplementation(async () => null)
  countLivePassagesAfter.mockImplementation(async () => 0)
}

/**
 * Points "@/lib/actions/entries" and "@/lib/db/queries" at this module's
 * doubles. Call it at the top of each consuming file, immediately before that
 * file's import of the tool module. lib/services/commit stays real, and never
 * gets a double: the service specs need the real one in the same process, so
 * a write is asserted on the bus instead (see captureBus).
 */
export function installMocks() {
  installFakeDb()
  mock.module("@/lib/actions/entries", () => ({
    appendEntryOutsideRun,
    updateEntryText,
    rewindToEntry,
  }))
  installQueryMocks()
}
