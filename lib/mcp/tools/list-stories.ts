// Owned by the list_stories bundle. See lib/mcp/CONVENTIONS.md before touching this.
import { z } from "zod"

import {
  countLivePassagesByStory,
  listStoriesWithCounts,
} from "@/lib/db/queries"

import {
  MAX_PAGE_SIZE,
  line,
  paginate,
  plural,
  runTool,
  shortDate,
  structured,
  type RegisterTool,
} from "@/lib/mcp/helpers"

const inputSchema = z.object({
  query: z
    .string()
    .optional()
    .describe("Filter by title or description substring."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_SIZE)
    .optional()
    .describe("Rows per page. Default 20."),
  cursor: z.string().optional().describe("nextCursor from a previous call."),
  sort: z
    .enum(["updated", "created", "title", "words", "passages"])
    .optional()
    .describe("Sort key. Default updated."),
  order: z
    .enum(["asc", "desc"])
    .optional()
    .describe("Default desc, except asc for title."),
})

type SortKey = NonNullable<z.infer<typeof inputSchema>["sort"]>
type SortOrder = NonNullable<z.infer<typeof inputSchema>["order"]>

const storyRow = z.object({
  id: z.string(),
  title: z.string(),
  genre: z.string(),
  passages: z.number().int().describe("Active passage count."),
  words: z.number().int(),
  createdAt: z.string().describe("ISO date."),
  updatedAt: z.string().describe("ISO date."),
})

const outputSchema = z.object({
  stories: z.array(storyRow),
  total: z.number().int().describe("Stories matching before paging."),
  nextCursor: z.string().optional(),
})

const DEFAULT_LIMIT = 20

type Row = {
  id: string
  title: string
  genre: string
  passages: number
  words: number
  createdAt: string
  updatedAt: string
}

// Full ISO timestamps are fixed-width, so code-unit order is time order.
const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

const compareBy: Record<SortKey, (a: Row, b: Row) => number> = {
  updated: (a, b) => byCodeUnit(a.updatedAt, b.updatedAt),
  created: (a, b) => byCodeUnit(a.createdAt, b.createdAt),
  title: (a, b) =>
    a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
  words: (a, b) => a.words - b.words,
  passages: (a, b) => a.passages - b.passages,
}

/** Sorts in place; ties fall back to id so a cursor pages a stable order. */
function sortRows(rows: Row[], sort: SortKey, order: SortOrder): Row[] {
  const sign = order === "asc" ? 1 : -1
  return rows.sort(
    (a, b) => sign * compareBy[sort](a, b) || byCodeUnit(a.id, b.id)
  )
}

export const registerListStories: RegisterTool = (server) => {
  server.registerTool(
    "list_stories",
    {
      title: "List stories",
      description:
        "Compact index of every story: id, title, genre, passage and word counts, created and last updated. Paged, newest-updated first unless you pass sort/order. Start here when you do not know a story id; use story_map once you do.",
      inputSchema,
      outputSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) =>
      runTool("list_stories", async () => {
        const [summaries, passageCounts] = await Promise.all([
          listStoriesWithCounts(),
          countLivePassagesByStory(),
        ])

        const needle = args.query?.trim().toLowerCase() ?? ""
        const filtered =
          needle === ""
            ? summaries
            : summaries.filter(
                (story) =>
                  story.title.toLowerCase().includes(needle) ||
                  story.genre.toLowerCase().includes(needle) ||
                  story.description.toLowerCase().includes(needle)
              )

        const sort = args.sort ?? "updated"
        const order = args.order ?? (sort === "title" ? "asc" : "desc")
        const rows = sortRows(
          filtered.map((story) => ({
            id: story.id,
            title: story.title,
            genre: story.genre,
            passages: passageCounts.get(story.id) ?? 0,
            words: story.wordCount ?? 0,
            createdAt: story.createdAt,
            updatedAt: story.updatedAt,
          })),
          sort,
          order
        )

        const page = paginate(rows, args.cursor, args.limit ?? DEFAULT_LIMIT)
        const stories = page.items.map((row) => ({
          ...row,
          createdAt: shortDate(row.createdAt),
          updatedAt: shortDate(row.updatedAt),
        }))
        const isDefaultOrder = sort === "updated" && order === "desc"

        return structured(
          line(
            plural(page.total, "story", "stories"),
            `${stories.length} returned`,
            !isDefaultOrder && `by ${sort}, ${order}`
          ),
          { stories, total: page.total, nextCursor: page.nextCursor }
        )
      })
  )
}
