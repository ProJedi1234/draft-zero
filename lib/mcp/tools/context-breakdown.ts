// Owned by the context_breakdown bundle. See lib/mcp/CONVENTIONS.md before
// touching this.
//
// Wraps loadEntryContext (lib/actions/context.ts) rather than composing a
// second time: that action already reconstructs exactly what a passage was
// shown, against the lorebook, memory and window AS THEY STAND, and
// describeContext (lib/generation/breakdown.ts) already slices the result
// into per-section tokens the way the app's own context viewer does. This
// tool is a compact re-shaping of both, not a new implementation.
import { z } from "zod"

import { loadEntryContext } from "@/lib/actions/context"
import { getStoryFull, resolveStoryRecap } from "@/lib/db/queries"
import { describeContext } from "@/lib/generation/breakdown"
import type { ContextSectionId } from "@/lib/generation/types"

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
  position: z
    .number()
    .int()
    .optional()
    .describe(
      "Which passage's context to inspect. Default the newest one — the context most recently composed for a write."
    ),
})

/** Wire name for each internal ContextSectionId — see CONTEXT_SECTION_ORDER. */
const SECTION_WIRE_NAME: Record<
  ContextSectionId,
  "systemPrompt" | "memory" | "recap" | "lore" | "authorsNote" | "manuscript"
> = {
  system: "systemPrompt",
  memory: "memory",
  lore: "lore",
  summary: "recap",
  story: "manuscript",
  authorsNote: "authorsNote",
}

const outputSchema = z.object({
  storyId: z.string(),
  position: z
    .number()
    .int()
    .describe("The passage this context was composed for."),
  recap: z
    .object({
      id: z.string(),
      throughPosition: z
        .number()
        .int()
        .describe("Last slot the resolved recap version covers."),
      createdAt: z.string(),
    })
    .nullable()
    .describe(
      "The recap row that resolved, or null when the story has none yet."
    ),
  memory: z.object({ present: z.boolean(), tokens: z.number().int() }),
  authorsNote: z.object({ present: z.boolean(), tokens: z.number().int() }),
  sections: z
    .array(
      z.object({
        name: z.enum([
          "systemPrompt",
          "memory",
          "recap",
          "lore",
          "authorsNote",
          "manuscript",
        ]),
        tokens: z.number().int(),
        chars: z.number().int(),
      })
    )
    .describe("Only sections that contributed something, in send order."),
  lore: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        triggeredBy: z
          .array(z.string())
          .describe("Keys that fired; empty when always-active."),
        tokens: z.number().int(),
      })
    )
    .describe("Entries that actually made it in, after the budget."),
  totalTokens: z.number().int(),
  contextWindow: z.number().int(),
  loreBudgetPercent: z
    .number()
    .int()
    .describe(
      "Percent (0-100) of the window left after fixed overhead that lore may claim; the unspent share returns to prose."
    ),
  droppedLore: z
    .number()
    .int()
    .describe("Entries that triggered but lost the budget."),
})

export const registerContextBreakdown: RegisterTool = (server) => {
  server.registerTool(
    "context_breakdown",
    {
      title: "Context breakdown",
      description:
        "Why the model wrote what it wrote: exactly what a passage was shown. Answers which lore entries fired and on which keys, how many triggered but were DROPPED for want of budget, which recap version resolved, whether memory and the author's note were present, and per-section token counts against the story's contextWindow and lore budget. Defaults to the newest passage. This is the tool for \"my lore did not seem to apply\" and for anything else the writer cannot see from the manuscript.",
      inputSchema,
      outputSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) =>
      runTool("context_breakdown", async () => {
        // One full-manuscript read to resolve which entry "newest" (or a
        // given position) names, plus the story's own loreBudget setting —
        // loadEntryContext performs a second, identical read a moment later
        // to compose the context itself. Duplicated deliberately rather than
        // reimplementing loadEntryContext's truncation-by-index here: this
        // tool wraps that action's logic, not the story's manuscript loader.
        const story = await getStoryFull(args.storyId)
        if (!story)
          throw new ToolInputError(`No story with id ${args.storyId}.`)
        if (story.entries.length === 0) {
          throw new ToolInputError(
            "This story has no passages yet. Write one, then check its context."
          )
        }
        const target =
          args.position === undefined
            ? story.entries[story.entries.length - 1]
            : story.entries.find((entry) => entry.position === args.position)
        if (!target) {
          throw new ToolInputError(
            `No live passage at position ${args.position}. Call story_map or read for the current range.`
          )
        }

        const [loaded, recap] = await Promise.all([
          loadEntryContext(args.storyId, target.id),
          resolveStoryRecap(args.storyId),
        ])
        if (!loaded.ok) throw new ToolInputError(loaded.error)
        if (!loaded.data) {
          throw new ToolInputError(
            "That passage is no longer in the manuscript. Call story_map for the current range."
          )
        }

        const breakdown = describeContext(
          loaded.data.context,
          loaded.data.contextWindow
        )

        const sections = breakdown.sections.map((section) => ({
          name: SECTION_WIRE_NAME[section.id],
          tokens: section.tokens,
          chars: section.chars,
        }))

        const memorySection = breakdown.sections.find((s) => s.id === "memory")
        const authorsNoteSection = breakdown.sections.find(
          (s) => s.id === "authorsNote"
        )

        const lore = (
          breakdown.sections.find((s) => s.id === "lore")?.items ?? []
        ).map((item) => ({
          id: item.id,
          name: item.label,
          triggeredBy: item.matchedKey ? [item.matchedKey] : [],
          tokens: item.tokens,
        }))

        const droppedLore = Math.max(
          0,
          loaded.data.context.fit.loreMatched - loaded.data.context.lore.length
        )

        return structured(
          line(
            `position ${target.position}`,
            `${breakdown.usedTokens}/${breakdown.windowTokens} tokens`,
            recap ? `recap through ${recap.throughPosition}` : "no recap yet",
            droppedLore > 0
              ? `${plural(droppedLore, "lore entry", "lore entries")} dropped`
              : undefined
          ),
          {
            storyId: args.storyId,
            position: target.position,
            recap: recap
              ? {
                  id: recap.id,
                  throughPosition: recap.throughPosition,
                  createdAt: recap.createdAt,
                }
              : null,
            memory: {
              present: memorySection !== undefined,
              tokens: memorySection?.tokens ?? 0,
            },
            authorsNote: {
              present: authorsNoteSection !== undefined,
              tokens: authorsNoteSection?.tokens ?? 0,
            },
            sections,
            lore,
            totalTokens: breakdown.usedTokens,
            contextWindow: breakdown.windowTokens,
            loreBudgetPercent: story.settings.loreBudget,
            droppedLore,
          }
        )
      })
  )
}
