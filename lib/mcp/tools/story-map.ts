// Owned by the story_map bundle. See lib/mcp/CONVENTIONS.md before touching this.
import { z } from "zod"

import {
  getManuscriptBounds,
  getStory,
  listLorebookEntries,
} from "@/lib/db/queries"

import {
  line,
  plural,
  ToolInputError,
  runTool,
  structured,
  type RegisterTool,
} from "@/lib/mcp/helpers"

const inputSchema = z.object({
  storyId: z.string().describe("Story id from list_stories."),
})

const outputSchema = z.object({
  id: z.string(),
  title: z.string(),
  genre: z.string(),
  description: z.string(),
  recap: z.string().describe("Current rolling summary; the story so far."),
  memory: z.string().describe("Always-on facts prepended to every generation."),
  authorsNote: z.string().describe("Steering note injected near the tail."),
  lore: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        keys: z.array(z.string()).describe("Trigger words."),
        enabled: z.boolean(),
        alwaysActive: z.boolean(),
      })
    )
    .describe(
      "Index only — names and triggers, no content. Use lore_get for a body."
    ),
  firstPosition: z.number().int().describe("Lowest live slot; -1 when empty."),
  lastPosition: z.number().int().describe("Highest live slot; -1 when empty."),
  counts: z.object({
    passages: z.number().int(),
    images: z.number().int(),
    lore: z.number().int(),
    words: z.number().int(),
  }),
  generation: z
    .object({
      model: z.string(),
      contextWindow: z.number().int(),
      loreBudget: z.number().int(),
      temperature: z.number(),
    })
    .describe("Read-only. Settings are not editable through MCP."),
})

export const registerStoryMap: RegisterTool = (server) => {
  server.registerTool(
    "story_map",
    {
      title: "Story map",
      description:
        "Everything about one story except its prose: recap, memory, author's note, lorebook index, position bounds, counts, and read-only generation settings. A few hundred tokens. Read this before any other story tool.",
      inputSchema,
      outputSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) =>
      runTool("story_map", async () => {
        const story = await getStory(args.storyId)
        if (story === null) {
          throw new ToolInputError(`No story with id ${args.storyId}.`)
        }

        const [lore, bounds] = await Promise.all([
          listLorebookEntries(args.storyId),
          getManuscriptBounds(args.storyId),
        ])

        const passages = (story.entriesBefore ?? 0) + story.entries.length

        return structured(
          line(
            story.title,
            plural(passages, "passage"),
            plural(lore.length, "lore entry", "lore entries"),
            plural(story.images.length, "image")
          ),
          {
            id: story.id,
            title: story.title,
            genre: story.genre,
            description: story.description,
            recap: story.summary,
            memory: story.memory,
            authorsNote: story.authorsNote,
            lore: lore.map((entry) => ({
              id: entry.id,
              name: entry.name,
              keys: entry.keys,
              enabled: entry.enabled,
              alwaysActive: entry.alwaysActive,
            })),
            firstPosition: bounds.empty ? -1 : bounds.first,
            lastPosition: bounds.empty ? -1 : bounds.last,
            counts: {
              passages,
              images: story.images.length,
              lore: lore.length,
              words: story.wordCount,
            },
            generation: {
              model: story.settings.modelId,
              contextWindow: story.settings.contextWindow,
              loreBudget: story.settings.loreBudget,
              temperature: story.settings.temperature,
            },
          }
        )
      })
  )
}
