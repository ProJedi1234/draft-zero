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
})

const storyRow = z.object({
  id: z.string(),
  title: z.string(),
  genre: z.string(),
  passages: z.number().int().describe("Active passage count."),
  words: z.number().int(),
  updatedAt: z.string().describe("ISO date."),
})

const outputSchema = z.object({
  stories: z.array(storyRow),
  total: z.number().int().describe("Stories matching before paging."),
  nextCursor: z.string().optional(),
})

const DEFAULT_LIMIT = 20

export const registerListStories: RegisterTool = (server) => {
  server.registerTool(
    "list_stories",
    {
      title: "List stories",
      description:
        "Compact index of every story: id, title, genre, passage and word counts, last updated. Paged. Start here when you do not know a story id; use story_map once you do.",
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

        const page = paginate(
          filtered,
          args.cursor,
          args.limit ?? DEFAULT_LIMIT
        )

        const stories = page.items.map((story) => ({
          id: story.id,
          title: story.title,
          genre: story.genre,
          passages: passageCounts.get(story.id) ?? 0,
          words: story.wordCount ?? 0,
          updatedAt: shortDate(story.updatedAt),
        }))

        return structured(
          line(
            plural(page.total, "story", "stories"),
            `${stories.length} returned`
          ),
          { stories, total: page.total, nextCursor: page.nextCursor }
        )
      })
  )
}
