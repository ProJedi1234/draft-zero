// search — case-insensitive text search across live passages and lorebook
// content, for one story or every story. Returns positions/ids and short
// snippets, never full text: a hit is a pointer, followed with `read` or
// `lore_get`.
import { z } from "zod"

import {
  escapeLikeNeedle,
  getStoryTitle,
  searchLorebookContent,
  searchStoryEntries,
} from "@/lib/db/queries"
import {
  clampLimit,
  line,
  matchSnippet,
  MAX_PAGE_SIZE,
  paginate,
  runTool,
  structured,
  ToolInputError,
  type RegisterTool,
} from "@/lib/mcp/helpers"

const inputSchema = z.object({
  query: z.string().min(1).describe("Text to find. Case-insensitive."),
  storyId: z
    .string()
    .optional()
    .describe("Scope to one story. Omit to search all."),
  scope: z
    .enum(["passages", "lore", "all"])
    .optional()
    .describe("What to search. Default all."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_SIZE)
    .optional()
    .describe("Max hits per page. Default 20."),
  cursor: z.string().optional().describe("nextCursor from a previous call."),
})

const hit = z.object({
  kind: z.enum(["passage", "lore"]),
  storyId: z.string(),
  storyTitle: z.string(),
  position: z
    .number()
    .int()
    .optional()
    .describe("Set for passages; use it with read."),
  loreId: z.string().optional().describe("Set for lore; use it with lore_get."),
  name: z.string().optional().describe("Lore entry name."),
  snippet: z.string().describe("~120 chars around the match."),
})

const outputSchema = z.object({
  hits: z.array(hit),
  total: z.number().int().describe("Matches found before paging."),
  nextCursor: z.string().optional(),
})

const DEFAULT_LIMIT = 20

type Hit = z.infer<typeof hit>

export const registerSearch: RegisterTool = (server) => {
  server.registerTool(
    "search",
    {
      title: "Search",
      description:
        "Find text across passages and lorebook entries. Returns positions and short snippets, never full passages — follow a hit with read or lore_get.",
      inputSchema,
      outputSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) =>
      runTool("search", async () => {
        const needle = args.query.trim()
        if (needle === "") throw new ToolInputError("query must not be blank.")

        if (args.storyId !== undefined) {
          const title = await getStoryTitle(args.storyId)
          if (title === null)
            throw new ToolInputError(
              `No story with id ${args.storyId}. Call list_stories for valid ids.`
            )
        }

        const scope = args.scope ?? "all"
        const limit = clampLimit(args.limit ?? DEFAULT_LIMIT)
        const pattern = escapeLikeNeedle(needle)

        const [entryRows, loreRows] = await Promise.all([
          scope === "lore"
            ? Promise.resolve([])
            : searchStoryEntries(pattern, args.storyId),
          scope === "passages"
            ? Promise.resolve([])
            : searchLorebookContent(pattern, args.storyId),
        ])

        const hits: Hit[] = [
          ...entryRows.map((row): Hit => ({
            kind: "passage",
            storyId: row.storyId,
            storyTitle: row.storyTitle,
            position: row.position,
            snippet: matchSnippet(row.text, needle),
          })),
          ...loreRows.map((row): Hit => ({
            kind: "lore",
            storyId: row.storyId,
            storyTitle: row.storyTitle,
            loreId: row.id,
            name: row.name,
            snippet: matchSnippet(`${row.name} — ${row.content}`, needle),
          })),
        ]

        const page = paginate(hits, args.cursor, limit)
        return structured(
          line(
            `${page.items.length} of ${page.total} match${page.total === 1 ? "" : "es"} for "${needle}"`,
            page.nextCursor && "more available"
          ),
          { hits: page.items, total: page.total, nextCursor: page.nextCursor }
        )
      })
  )
}
