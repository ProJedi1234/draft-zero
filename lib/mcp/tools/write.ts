// lib/mcp/tools/write.ts — appends one passage to the end of a story.
//
// "narration" and "do"/"say" reach the app through two different entry points
// because that mirrors what the UI itself does: a player move is typed first
// person and translated (appendActionEntry → translateAction), while plain
// narration is prose as-is with no actionKind. Both bottom out in
// appendEntryCore, the one place position, provenance and the story_ops
// journal entry get written together, and both are reached through
// appendEntryOutsideRun (added to lib/actions/entries.ts for this) so the
// live-run guard the composer gets from reserveRun covers this caller too.
//
// The wrapper does not call commitChange — the doc comment on appendActionEntry
// explains why (the UI's caller owns the timing so a request-scoped
// revalidate doesn't sit in the critical path before the first generated
// token). That reason doesn't apply here: this tool has no optimistic echo to
// protect, so it calls commitChange itself once the row is committed, which
// is what puts this write in the undo journal AND on the sync bus, matching
// the plan's "Journal + bus" requirement.
import { z } from "zod"

import { commitChange } from "@/lib/actions/commit"
import { appendEntryOutsideRun } from "@/lib/actions/entries"
import {
  line,
  plural,
  runTool,
  structured,
  ToolInputError,
  wordCount,
  type RegisterTool,
} from "@/lib/mcp/helpers"
import type { ActionKind } from "@/lib/types"

const inputSchema = z.object({
  storyId: z.string(),
  text: z
    .string()
    .min(1)
    .describe(
      "The passage. Prose for narration; the bare first-person action or line for do/say — the app translates it into second person the way the composer does."
    ),
  mode: z
    .enum(["narration", "do", "say"])
    .optional()
    .describe("How the turn is framed. Default narration."),
})

const outputSchema = z.object({
  storyId: z.string(),
  position: z.number().int().describe("The slot the passage landed in."),
  kind: z.enum(["narration", "do", "say"]),
  words: z.number().int(),
})

export const registerWrite: RegisterTool = (server) => {
  server.registerTool(
    "write",
    {
      title: "Append passage",
      description:
        "Append one passage to the end of a story as narration or as a do/say turn. Returns the position it took — not the text back. Journalled (undoable in the app) and synced to open browsers.",
      inputSchema,
      outputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) =>
      runTool("write", async () => {
        const mode = args.mode ?? "narration"

        // Refuses while a generation holds the story — see
        // appendEntryOutsideRun. An append that lands mid-run races the run
        // loop for a position, and the loser's insert dies on the partial
        // unique index, taking a billed passage with it.
        const result = await appendEntryOutsideRun(
          args.storyId,
          mode as "narration" | ActionKind,
          args.text
        )
        if (!result.ok) throw new ToolInputError(result.error)

        // Neither path above touches the sync bus or the request cache — see
        // the file header. This is the one line that makes an MCP write show
        // up in an open browser the way a UI write does.
        commitChange(args.storyId)

        const { entry } = result.data
        // Rows always carry `position`; it's optional on the type only for
        // hand-built fixtures elsewhere in the app.
        const position = entry.position ?? 0
        const words = wordCount(entry.text)

        return structured(
          line(`wrote position ${position}`, plural(words, "word")),
          { storyId: args.storyId, position, kind: mode, words }
        )
      })
  )
}
