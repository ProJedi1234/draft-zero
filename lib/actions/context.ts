"use server"

import { NO_ORIGIN } from "@/lib/services/context"
import { loadEntryContext as loadEntryContextService } from "@/lib/services/entries"
import type { EntryContext } from "@/lib/services/entries.schema"
import type { ActionResult } from "@/lib/types"

/** What this passage was shown; see the service for why it composes afresh. */
export async function loadEntryContext(
  storyId: string,
  entryId: string
): Promise<ActionResult<EntryContext | null>> {
  return loadEntryContextService({ storyId, entryId }, NO_ORIGIN)
}
