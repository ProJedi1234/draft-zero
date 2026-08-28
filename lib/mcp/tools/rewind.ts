// lib/mcp/tools/rewind.ts — retires everything after a position, the way the
// app's rewind button does.
//
// rewindToEntry (lib/actions/entries.ts) takes an entryId and only ever
// touches story_entries — story_images are not part of this cut in the app
// today, so this tool doesn't invent an image-retiring step of its own; that
// would diverge from what "the app's rewind" actually does. See the run
// notes for where the plan's stub wording ("passages and images") overstated
// this.
//
// The position→entry lookup and the after-count both live in
// lib/db/queries.ts, on the same "live take" terms `edit` uses — see edit.ts's
// header.
import { z } from "zod"

import { rewindToEntry } from "@/lib/actions/entries"
import {
  countLivePassagesAfter,
  getLivePassageAtPosition,
} from "@/lib/db/queries"
import {
  line,
  plural,
  runTool,
  structured,
  ToolInputError,
  type RegisterTool,
} from "@/lib/mcp/helpers"

const inputSchema = z.object({
  storyId: z.string(),
  toPosition: z
    .number()
    .int()
    .min(0)
    .describe("Last slot to keep. Everything after it is retired."),
})

const outputSchema = z.object({
  storyId: z.string(),
  lastPosition: z.number().int().describe("The story's new tail."),
  removed: z.number().int().describe("Passages retired."),
})

export const registerRewind: RegisterTool = (server) => {
  server.registerTool(
    "rewind",
    {
      title: "Rewind story",
      description:
        "Retire every passage after a position, the way the app's rewind does — a soft delete, so the recap falls back to the newest version the remaining text still covers. Journalled (undoable in the app) and synced to open browsers.",
      inputSchema,
      outputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) =>
      runTool("rewind", async () => {
        const anchor = await getLivePassageAtPosition(
          args.storyId,
          args.toPosition
        )
        if (!anchor) {
          throw new ToolInputError(
            `No passage at position ${args.toPosition}. It may be an image, already retired, or past the story's end — call read to check.`
          )
        }

        const removed = await countLivePassagesAfter(
          args.storyId,
          args.toPosition
        )
        if (removed === 0) {
          throw new ToolInputError(
            `There's nothing after position ${args.toPosition} to retire.`
          )
        }

        const result = await rewindToEntry(args.storyId, anchor.id)
        if (!result.ok) throw new ToolInputError(result.error)

        return structured(
          line(
            `rewound to position ${args.toPosition}`,
            `retired ${plural(removed, "passage")}`
          ),
          { storyId: args.storyId, lastPosition: args.toPosition, removed }
        )
      })
  )
}
