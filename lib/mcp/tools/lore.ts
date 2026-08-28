// lore_get + lore_write — the lorebook's two MCP entry points. Both call
// straight into lib/actions/lorebook.ts so create/update behavior (validation,
// the undo/bus commit) is byte-identical to the UI's own editor.
//
// Two tools in one file because they share one table and one shape. They
// register separately so each keeps its place in the global ordering: lore_get
// sits with the reads, lore_write with the writes.
import { z } from "zod"

import {
  createLorebookEntry,
  updateLorebookEntry,
} from "@/lib/actions/lorebook"
import {
  getLorebookEntry,
  getStoryTitle,
  listLorebookEntries,
} from "@/lib/db/queries"
import {
  runTool,
  structured,
  ToolInputError,
  type RegisterTool,
} from "@/lib/mcp/helpers"
import { LOREBOOK_CATEGORIES } from "@/lib/types"
import type { LorebookCategory, NewLorebookEntry } from "@/lib/types"

/**
 * The closed set, straight off the app's own list so the two cannot drift.
 * The column is plain text with no CHECK constraint and MCP is the only writer
 * that does not already map onto the union, so this schema is the constraint:
 * an off-union category persists fine and then matches no chip in the
 * lorebook UI, visible under "All" and nowhere else.
 */
const categoryValues = LOREBOOK_CATEGORIES.map((entry) => entry.value) as [
  LorebookCategory,
  ...LorebookCategory[],
]
const category = z.enum(categoryValues)

const loreEntry = z.object({
  id: z.string(),
  name: z.string(),
  category,
  keys: z
    .array(z.string())
    .describe("Words that trigger this entry into context."),
  content: z.string(),
  priority: z
    .number()
    .int()
    .describe("Higher wins when the lore budget is tight."),
  enabled: z.boolean(),
  alwaysActive: z.boolean().describe("Rides every generation, trigger or not."),
})

/* --------------------------------- read ---------------------------------- */

const getInput = z.object({
  storyId: z.string(),
  id: z.string().optional().describe("Entry id. Give this or name."),
  name: z.string().optional().describe("Exact entry name, if you have no id."),
})

export const registerLoreGet: RegisterTool = (server) => {
  server.registerTool(
    "lore_get",
    {
      title: "Read lore entry",
      description:
        "Full content of one lorebook entry, by id or exact name. story_map lists names and trigger keys; this is how you read a body.",
      inputSchema: getInput,
      outputSchema: loreEntry,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) =>
      runTool("lore_get", async () => {
        if (args.id === undefined && args.name === undefined)
          throw new ToolInputError("Give id or name.")

        const entry = args.id
          ? await getLorebookEntry(args.id)
          : ((await listLorebookEntries(args.storyId)).find(
              (row) => row.name === args.name
            ) ?? null)

        // A found-by-id entry must still belong to this story: `id` alone is
        // not story-scoped in the table, so a foreign id must read as "not
        // found" rather than leak another story's lore.
        if (entry === null || entry.storyId !== args.storyId)
          throw new ToolInputError(
            args.id
              ? `No lore entry with id ${args.id} in this story.`
              : `No lore entry named "${args.name}". Call story_map for the index.`
          )

        return structured(
          `${entry.name} · ${entry.category} · ${entry.keys.length} key${entry.keys.length === 1 ? "" : "s"}`,
          {
            id: entry.id,
            name: entry.name,
            category: entry.category,
            keys: entry.keys,
            content: entry.content,
            priority: entry.priority,
            enabled: entry.enabled,
            alwaysActive: entry.alwaysActive,
          }
        )
      })
  )
}

/* --------------------------------- write --------------------------------- */

const writeInput = z.object({
  storyId: z.string(),
  id: z
    .string()
    .optional()
    .describe("Omit to create; give it to update in place."),
  name: z.string().optional().describe("Required when creating."),
  category: category.optional().describe("Defaults to concept on create."),
  keys: z
    .array(z.string())
    .optional()
    .describe("Trigger words. Replaces the whole list."),
  content: z.string().optional(),
  priority: z.number().int().optional(),
  enabled: z.boolean().optional(),
  alwaysActive: z.boolean().optional(),
})

const writeOutput = z.object({
  id: z.string(),
  name: z.string(),
  created: z.boolean().describe("False when an existing entry was updated."),
  changed: z.array(z.string()).describe("Fields this call actually moved."),
})

/** Same-value array check — a `keys` list unchanged in substance is not a change. */
function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

export const registerLoreWrite: RegisterTool = (server) => {
  server.registerTool(
    "lore_write",
    {
      title: "Write lore entry",
      description:
        "Create or update one lorebook entry. Omit id to create, give id to update — only the fields you pass change. Journalled and synced to open browsers.",
      inputSchema: writeInput,
      outputSchema: writeOutput,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) =>
      runTool("lore_write", async () => {
        if (args.id !== undefined) {
          const existing = await getLorebookEntry(args.id)
          if (existing === null || existing.storyId !== args.storyId)
            throw new ToolInputError(
              `No lore entry with id ${args.id} in this story.`
            )

          const patch: Partial<NewLorebookEntry> = {}
          const changed: string[] = []

          if (args.name !== undefined && args.name.trim() !== existing.name) {
            const name = args.name.trim()
            if (name === "") throw new ToolInputError("name cannot be blank.")
            patch.name = name
            changed.push("name")
          }
          if (
            args.category !== undefined &&
            args.category !== existing.category
          ) {
            patch.category = args.category
            changed.push("category")
          }
          if (args.keys !== undefined && !sameKeys(args.keys, existing.keys)) {
            patch.keys = args.keys
            changed.push("keys")
          }
          if (args.content !== undefined && args.content !== existing.content) {
            patch.content = args.content
            changed.push("content")
          }
          if (
            args.priority !== undefined &&
            args.priority !== existing.priority
          ) {
            patch.priority = args.priority
            changed.push("priority")
          }
          if (args.enabled !== undefined && args.enabled !== existing.enabled) {
            patch.enabled = args.enabled
            changed.push("enabled")
          }
          if (
            args.alwaysActive !== undefined &&
            args.alwaysActive !== existing.alwaysActive
          ) {
            patch.alwaysActive = args.alwaysActive
            changed.push("alwaysActive")
          }

          if (changed.length > 0) {
            const result = await updateLorebookEntry(args.id, patch)
            if (!result.ok) throw new ToolInputError(result.error)
          }

          return structured(
            changed.length > 0
              ? `updated "${patch.name ?? existing.name}" · ${changed.length} field${changed.length === 1 ? "" : "s"}`
              : `no change · "${existing.name}"`,
            {
              id: args.id,
              name: patch.name ?? existing.name,
              created: false,
              changed,
            }
          )
        }

        const name = args.name?.trim() ?? ""
        if (name === "")
          throw new ToolInputError("name is required to create a lore entry.")

        // The update branch gets this from the entry it loaded; create has
        // nothing to check against, and story_id is a foreign key — an unknown
        // id would surface as the opaque "the server logged the reason" line
        // instead of something the model can correct.
        if ((await getStoryTitle(args.storyId)) === null) {
          throw new ToolInputError(
            `No story with id ${args.storyId}. Call list_stories for valid ids.`
          )
        }

        const result = await createLorebookEntry(args.storyId, {
          name,
          category: args.category ?? "concept",
          keys: args.keys ?? [],
          content: args.content ?? "",
          priority: args.priority ?? 50,
          enabled: args.enabled ?? true,
          alwaysActive: args.alwaysActive ?? false,
        })
        if (!result.ok) throw new ToolInputError(result.error)

        return structured(`created "${name}"`, {
          id: result.data.id,
          name,
          created: true,
          changed: [
            "name",
            "category",
            "keys",
            "content",
            "priority",
            "enabled",
            "alwaysActive",
          ],
        })
      })
  )
}
