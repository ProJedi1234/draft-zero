// Owned by the read bundle. See lib/mcp/CONVENTIONS.md before touching this.
import { z } from "zod"

import {
  getManuscriptBounds,
  getStoryTitle,
  readManuscriptWindow,
} from "@/lib/db/queries"

import {
  line,
  plural,
  resolveRange,
  snippet,
  ToolInputError,
  runTool,
  structured,
  type RegisterTool,
} from "@/lib/mcp/helpers"

/** The shared range endpoint: a slot number, or an anchor at either bound. */
const position = z.union([z.number().int().min(0), z.enum(["start", "end"])])

const inputSchema = z.object({
  storyId: z.string(),
  from: position
    .optional()
    .describe("First slot, inclusive. Omit to read the tail."),
  to: position.optional().describe("Last slot, inclusive."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("Max entries. Default 10."),
})

const entry = z.object({
  position: z.number().int(),
  kind: z.enum(["narration", "say", "do", "image"]),
  text: z
    .string()
    .describe("Full passage text, or a one-line stub for an image."),
})

const outputSchema = z.object({
  entries: z.array(entry),
  from: z.number().int().describe("First slot actually returned."),
  to: z.number().int().describe("Last slot actually returned."),
  firstPosition: z.number().int().describe("Story's lowest live slot."),
  lastPosition: z.number().int().describe("Story's highest live slot."),
  hasMore: z.boolean().describe("True when older material sits below `from`."),
})

/** Chars of an image's prompt worth showing in a manuscript stub. */
const IMAGE_STUB_CHARS = 120

export const registerRead: RegisterTool = (server) => {
  server.registerTool(
    "read",
    {
      title: "Read passages",
      description:
        "Read a range of the manuscript by position. Defaults to the last 10 entries; pass from/to (numbers, or 'start'/'end') to page elsewhere. Active takes only; images come back as one-line stubs.",
      inputSchema,
      outputSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) =>
      runTool("read", async () => {
        const title = await getStoryTitle(args.storyId)
        if (title === null) {
          throw new ToolInputError(`No story with id ${args.storyId}.`)
        }

        const bounds = await getManuscriptBounds(args.storyId)
        const range = resolveRange(
          { from: args.from, to: args.to, limit: args.limit },
          { first: bounds.first, last: bounds.last },
          10
        )

        const slots = await readManuscriptWindow(
          args.storyId,
          range.from,
          range.to
        )
        const entries = slots.map((slot) => ({
          position: slot.position,
          kind: slot.kind,
          // The prompt is the only text an image slot has; it earns a line so
          // the model knows a picture sits here, not a gap in the numbering.
          text:
            slot.kind === "image"
              ? `Image — ${snippet(slot.text, IMAGE_STUB_CHARS)}`
              : slot.text,
        }))

        const firstPosition = bounds.empty ? -1 : bounds.first
        const lastPosition = bounds.empty ? -1 : bounds.last
        const hasMore = !bounds.empty && range.from > bounds.first

        const actualFrom = entries[0]?.position ?? range.from
        const actualTo = entries[entries.length - 1]?.position ?? range.to

        return structured(
          line(
            entries.length === 0
              ? `no entries in range`
              : `positions ${actualFrom}–${actualTo}`,
            plural(entries.length, "entry", "entries"),
            hasMore && "more before"
          ),
          {
            entries,
            from: actualFrom,
            to: actualTo,
            firstPosition,
            lastPosition,
            hasMore,
          }
        )
      })
  )
}
