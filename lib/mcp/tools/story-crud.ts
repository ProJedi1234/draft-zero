// lib/mcp/tools/story-crud.ts — create_story + update_story + delete_story.
//
// Three tools in one file because they are one table's lifecycle. They
// register separately so each keeps its place in the global ordering. All
// three call into lib/actions/stories.ts so the ops journal, revalidation and
// sync bus stay identical to what the UI produces — this module never opens
// Drizzle for a write.
import { z } from "zod"

import {
  createStory,
  deleteStory,
  updateStoryMeta,
} from "@/lib/actions/stories"
import { countLivePassages, getStoryTitle } from "@/lib/db/queries"
import {
  acceptedContent,
  inputRequired,
  inputResponse,
  type CallToolResult,
} from "@modelcontextprotocol/server"

import {
  ToolInputError,
  line,
  plural,
  runTool,
  structured,
  type RegisterTool,
  type RequestStatePayload,
} from "@/lib/mcp/helpers"

/* -------------------------------- create --------------------------------- */

const createInput = z.object({
  title: z.string().min(1),
  description: z
    .string()
    .optional()
    .describe("One or two lines about the premise."),
  genre: z.string().optional(),
  memory: z
    .string()
    .optional()
    .describe("Always-on facts prepended to every generation."),
  systemPrompt: z
    .string()
    .optional()
    .describe("Overrides the app default for this story."),
})

const createOutput = z.object({
  id: z.string(),
  title: z.string(),
})

export const registerCreateStory: RegisterTool = (server) => {
  server.registerTool(
    "create_story",
    {
      title: "Create story",
      description:
        "Start a new, empty story. Returns its id — follow with write to put the first passage in. Journalled and synced to open browsers.",
      inputSchema: createInput,
      outputSchema: createOutput,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) =>
      runTool("create_story", async () => {
        const created = await createStory({ title: args.title })
        if (!created.ok) throw new ToolInputError(created.error)
        const { id } = created.data

        // createStory only takes a title — everything else the model may have
        // passed is a metadata patch applied right after, same as the UI would
        // do by creating then editing. Skipped entirely when nothing else was
        // given, so a bare create_story stays a single write.
        const patch: Parameters<typeof updateStoryMeta>[1] = {}
        if (args.description !== undefined) patch.description = args.description
        if (args.genre !== undefined) patch.genre = args.genre
        if (args.memory !== undefined) patch.memory = args.memory
        if (args.systemPrompt !== undefined)
          patch.systemPrompt = args.systemPrompt
        if (Object.keys(patch).length > 0) {
          const patched = await updateStoryMeta(id, patch)
          if (!patched.ok) throw new ToolInputError(patched.error)
        }

        return structured(line(`created "${args.title}"`, id), {
          id,
          title: args.title,
        })
      })
  )
}

/* -------------------------------- update --------------------------------- */

const updateInput = z.object({
  storyId: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  genre: z.string().optional(),
  memory: z
    .string()
    .optional()
    .describe("Always-on facts. Pass an empty string to clear."),
  authorsNote: z
    .string()
    .optional()
    .describe("Steering note injected near the tail."),
})

const updateOutput = z.object({
  id: z.string(),
  changed: z.array(z.string()).describe("Fields this call actually moved."),
})

export const registerUpdateStory: RegisterTool = (server) => {
  server.registerTool(
    "update_story",
    {
      title: "Update story",
      description:
        "Change a story's title, description, genre, memory or author's note. Only the fields you pass move. Journalled and synced to open browsers.",
      inputSchema: updateInput,
      outputSchema: updateOutput,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) =>
      runTool("update_story", async () => {
        const { storyId, ...fields } = args
        const changed = Object.entries(fields)
          .filter(([, value]) => value !== undefined)
          .map(([key]) => key)

        if (changed.length === 0) {
          throw new ToolInputError(
            "Nothing to update — pass at least one of title, description, genre, memory or authorsNote."
          )
        }

        const patch: Parameters<typeof updateStoryMeta>[1] = {}
        if (fields.title !== undefined) patch.title = fields.title
        if (fields.description !== undefined)
          patch.description = fields.description
        if (fields.genre !== undefined) patch.genre = fields.genre
        if (fields.memory !== undefined) patch.memory = fields.memory
        if (fields.authorsNote !== undefined)
          patch.authorsNote = fields.authorsNote

        const result = await updateStoryMeta(storyId, patch)
        if (!result.ok) throw new ToolInputError(result.error)

        return structured(line(`updated ${storyId}`, changed.join(", ")), {
          id: storyId,
          changed,
        })
      })
  )
}

/* -------------------------------- delete --------------------------------- */

const deleteInput = z.object({
  storyId: z.string(),
})

const deleteOutput = z.object({
  id: z.string(),
  title: z.string(),
  deleted: z
    .boolean()
    .describe("False when the writer declined the confirmation."),
})

const confirmSchema = z.object({ confirm: z.boolean() })

/**
 * Title + live passage count for the confirmation question. Two small reads
 * rather than one join: `getStoryTitle` is also the existence check, so a
 * missing story short-circuits before the count is worth asking for.
 */
async function getDeleteConfirmationInfo(
  storyId: string
): Promise<{ title: string; passageCount: number } | null> {
  const title = await getStoryTitle(storyId)
  if (title === null) return null
  return { title, passageCount: await countLivePassages(storyId) }
}

/**
 * The only multi-round-trip tool in the server, and the only one that destroys
 * anything a rewind cannot bring back.
 *
 * First call returns `inputRequired(...)` with an elicitation asking the writer
 * to confirm, plus a sealed `requestState` naming this tool, the story id and
 * its title. The client re-calls with the answer; the retry reads the sealed
 * state back, checks `tool` before trusting anything in it, and only deletes
 * when the writer accepted with `confirm: true`. Declining, cancelling, or
 * answering `confirm: false` all leave the story untouched.
 */
export const registerDeleteStory: RegisterTool = (server, deps) => {
  server.registerTool(
    "delete_story",
    {
      title: "Delete story",
      description:
        "Permanently delete a story and everything in it — passages, images, lore, recaps. Asks the writer to confirm first and does nothing until they do. Not undoable; use rewind to walk a story back instead.",
      inputSchema: deleteInput,
      outputSchema: deleteOutput,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args, ctx) =>
      runTool("delete_story", async () => {
        const state = ctx.mcpReq.requestState<RequestStatePayload>()
        // A seal is this call's own only if it names this tool AND this story:
        // only the sealed id was ever shown to the writer, so a retry that
        // swaps `args.storyId` must not ride an old confirmation.
        const sealed =
          state &&
          state.tool === "delete_story" &&
          typeof state.storyId === "string" &&
          state.storyId === args.storyId
            ? { storyId: state.storyId, title: state.title }
            : null
        const answer = acceptedContent(
          ctx.mcpReq.inputResponses,
          "confirm",
          confirmSchema
        )

        // Round 2, refused. `acceptedContent` collapses decline, cancel and
        // "not asked yet" into undefined, so the raw view is the only thing
        // that tells them apart — and it has to, because a decline that fell
        // through to round 1 would re-ask the writer the same destructive
        // question on every "no" until the round cap turned it into an error.
        const view = inputResponse(ctx.mcpReq.inputResponses, "confirm")
        if (sealed && view.kind === "elicit" && view.action !== "accept") {
          return structured("Cancelled. Nothing was deleted.", {
            id: sealed.storyId,
            title: typeof sealed.title === "string" ? sealed.title : "",
            deleted: false,
          })
        }

        // Round 1 — no seal of this call's own, or one whose answer has not
        // arrived (or arrived malformed): ask.
        if (!sealed || !answer) {
          const info = await getDeleteConfirmationInfo(args.storyId)
          if (!info) {
            throw new ToolInputError(`No story with id ${args.storyId}.`)
          }
          // `runTool`'s body is typed `() => Promise<CallToolResult>` — it
          // knows nothing about the multi-round-trip result, only the every-
          // -other-tool one. `registerTool`'s own handler type is the wider
          // `CallToolResult | InputRequiredResult` (see ToolCallback in the
          // SDK's .d.mts), which is what actually reaches the wire; this cast
          // just gets past the narrower type runTool was written against.
          return inputRequired({
            inputRequests: {
              confirm: inputRequired.elicit({
                message: `Delete "${info.title}" (${plural(info.passageCount, "passage")})? This cannot be undone.`,
                requestedSchema: confirmSchema,
              }),
            },
            requestState: await deps.mintRequestState(
              {
                tool: "delete_story",
                storyId: args.storyId,
                title: info.title,
              },
              ctx
            ),
          }) as unknown as CallToolResult
        }

        // Everything below acts on the sealed id, not the retry's argument:
        // the id in the seal is the one the writer was asked about.
        const storyId = sealed.storyId
        const title = typeof sealed.title === "string" ? sealed.title : ""

        // Accepted, but answered "no" — the client rendered the boolean
        // rather than a decline button. Same outcome.
        if (!answer.confirm) {
          return structured("Cancelled. Nothing was deleted.", {
            id: storyId,
            title,
            deleted: false,
          })
        }

        const result = await deleteStory(storyId)
        if (!result.ok) throw new ToolInputError(result.error)

        return structured(line(`deleted "${title}"`, storyId), {
          id: storyId,
          title,
          deleted: true,
        })
      })
  )
}
