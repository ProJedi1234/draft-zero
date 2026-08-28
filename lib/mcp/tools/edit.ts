// lib/mcp/tools/edit.ts — rewrites one passage's prose in place, by position.
//
// The app's mutator, updateEntryText, takes an entryId; the plan hands this
// tool a position. getLivePassageAtPosition bridges the two — it lives in
// lib/db/queries.ts rather than here because `rewind` needs the same lookup
// on the same terms, and two copies of "live means active and not
// soft-deleted" is exactly how the two tools would drift apart.
import { z } from "zod"

import { updateEntryText } from "@/lib/actions/entries"
import { getLivePassageAtPosition } from "@/lib/db/queries"
import {
  line,
  runTool,
  structured,
  ToolInputError,
  wordCount,
  type RegisterTool,
} from "@/lib/mcp/helpers"

const inputSchema = z.object({
  storyId: z.string(),
  position: z
    .number()
    .int()
    .min(0)
    .describe("Slot to rewrite. Get it from read or search."),
  text: z.string().min(1).describe("Replacement text for the whole passage."),
})

const outputSchema = z.object({
  storyId: z.string(),
  position: z.number().int(),
  previousWords: z.number().int(),
  words: z.number().int(),
})

export const registerEdit: RegisterTool = (server) => {
  server.registerTool(
    "edit",
    {
      title: "Rewrite passage",
      description:
        "Replace the text of one passage in place, by position. Returns the word-count delta, not the text. Journalled (undoable in the app) and synced to open browsers.",
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
      runTool("edit", async () => {
        const existing = await getLivePassageAtPosition(
          args.storyId,
          args.position
        )
        if (!existing) {
          throw new ToolInputError(
            `No passage at position ${args.position}. It may be an image, retired, or past the story's end — call read to check.`
          )
        }

        const result = await updateEntryText(
          args.storyId,
          existing.id,
          args.text
        )
        if (!result.ok) throw new ToolInputError(result.error)

        const previousWords = wordCount(existing.text)
        const words = wordCount(args.text)

        return structured(
          line(
            `rewrote position ${args.position}`,
            `${previousWords} → ${words} words`
          ),
          {
            storyId: args.storyId,
            position: args.position,
            previousWords,
            words,
          }
        )
      })
  )
}
