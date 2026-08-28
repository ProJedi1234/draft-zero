// Owned by the usage bundle. See lib/mcp/CONVENTIONS.md before touching this.
import { z } from "zod"

import {
  getStoryTitle,
  getUsageAggregate,
  type UsageGroupBy,
} from "@/lib/db/queries"

import {
  line,
  plural,
  runTool,
  structured,
  ToolInputError,
  usd,
  type RegisterTool,
} from "@/lib/mcp/helpers"

const inputSchema = z.object({
  storyId: z
    .string()
    .optional()
    .describe("Scope to one story. Omit for the whole app."),
  groupBy: z
    .enum(["model", "requestKind", "day", "story"])
    .optional()
    .describe("Aggregation key. Default model."),
  since: z
    .string()
    .optional()
    .describe("ISO-8601 timestamp, inclusive lower bound on createdAt."),
  until: z
    .string()
    .optional()
    .describe("ISO-8601 timestamp, inclusive upper bound on createdAt."),
})

const group = z.object({
  key: z
    .string()
    .describe("The model id, request kind, YYYY-MM-DD day, or story title."),
  calls: z.number().int(),
  costUsd: z.number(),
  unpricedCalls: z
    .number()
    .int()
    .describe(
      "Calls never priced by the provider. Above zero, costUsd is a floor, not the total."
    ),
  promptTokens: z.number().int(),
  completionTokens: z.number().int(),
  reasoningTokens: z.number().int().describe("Tokens spent thinking."),
  cachedPromptTokens: z
    .number()
    .int()
    .describe("Subset of promptTokens served from a provider cache."),
})

const outputSchema = z.object({
  groups: z.array(group),
  totals: group.omit({ key: true }),
  window: z.object({
    since: z.string().describe('Resolved lower bound, or "" for all time.'),
    until: z.string().describe('Resolved upper bound, or "" for now.'),
  }),
})

type UsageGroup = z.infer<typeof group>
type UsageTotals = Omit<UsageGroup, "key">

const DEFAULT_GROUP_BY: UsageGroupBy = "model"

export const registerUsage: RegisterTool = (server) => {
  server.registerTool(
    "usage",
    {
      title: "Usage and spend",
      description:
        "Aggregated generation spend from the call ledger — cost, calls and token splits (including cached and reasoning tokens) grouped by model, request kind, day or story, over an optional date window. Summaries only; never individual calls.",
      inputSchema,
      outputSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) =>
      runTool("usage", async () => {
        // A ledger scoped to a story that does not exist matches no rows and
        // would report a confident $0 — indistinguishable from a story that
        // genuinely cost nothing. Every other story-scoped tool checks first.
        if (
          args.storyId !== undefined &&
          (await getStoryTitle(args.storyId)) === null
        ) {
          throw new ToolInputError(
            `No story with id ${args.storyId}. Call list_stories for valid ids.`
          )
        }

        const groupBy = args.groupBy ?? DEFAULT_GROUP_BY
        const aggregate = await getUsageAggregate({
          storyId: args.storyId,
          groupBy,
          since: args.since,
          until: args.until,
        })

        const groups: UsageGroup[] = aggregate.groups.map((row) => ({
          key: row.key,
          calls: row.calls,
          costUsd: Number(row.costUsd),
          unpricedCalls: row.unpricedCalls,
          promptTokens: row.promptTokens,
          completionTokens: row.completionTokens,
          reasoningTokens: row.reasoningTokens,
          cachedPromptTokens: row.cachedPromptTokens,
        }))
        const totals: UsageTotals = {
          calls: aggregate.totals.calls,
          costUsd: Number(aggregate.totals.costUsd),
          unpricedCalls: aggregate.totals.unpricedCalls,
          promptTokens: aggregate.totals.promptTokens,
          completionTokens: aggregate.totals.completionTokens,
          reasoningTokens: aggregate.totals.reasoningTokens,
          cachedPromptTokens: aggregate.totals.cachedPromptTokens,
        }

        return structured(
          line(
            `by ${groupBy}`,
            plural(groups.length, "group"),
            plural(totals.calls, "call"),
            // A floor, and it says so: "$0.8400+ · 12 unpriced" is honest
            // where "$0.8400" would not be.
            totals.unpricedCalls > 0
              ? `${usd(totals.costUsd)}+`
              : usd(totals.costUsd),
            totals.unpricedCalls > 0 && `${totals.unpricedCalls} unpriced`
          ),
          {
            groups,
            totals,
            window: { since: args.since ?? "", until: args.until ?? "" },
          }
        )
      })
  )
}
