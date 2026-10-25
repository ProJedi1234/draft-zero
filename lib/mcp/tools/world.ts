import {
  runTool,
  structured,
  ToolInputError,
  type RegisterTool,
} from "@/lib/mcp/helpers"
import { NO_ORIGIN } from "@/lib/services/context"
import { applyWorldPatch, getWorldState } from "@/lib/services/world"
import {
  applyWorldPatchInput,
  applyWorldPatchOutput,
  getWorldInput,
  getWorldOutput,
} from "@/lib/services/world.schema"

export const registerWorldState: RegisterTool = (server) => {
  server.registerTool(
    "world_state",
    {
      title: "Read living world",
      description:
        "Read the story clock in minutes since its start and every opted-in NPC's mind and memories. Day is floor(minutes / 1440) + 1. State follows the manuscript's live takes and undo history.",
      inputSchema: getWorldInput,
      outputSchema: getWorldOutput,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) =>
      runTool("world_state", async () => {
        const result = await getWorldState(args, NO_ORIGIN)
        if (!result.ok) throw new ToolInputError(result.error)
        return structured(
          `${result.data.state.minutes} minutes · ${result.data.state.npcs.length} NPCs`,
          result.data
        )
      })
  )
}

export const registerWorldPatch: RegisterTool = (server) => {
  server.registerTool(
    "world_patch",
    {
      title: "Correct living world",
      description:
        "Apply manual world corrections: set-clock uses absolute minutes, set-mind replaces an NPC's thought, add-memory needs a caller-minted unique memory id and importance 1–5, and strike-memory removes by id. Read ids with world_state. advance-clock is refused. Anchored to the latest live generated passage, or null before one exists, so undoing past it removes these changes. Refused while a generation is running.",
      inputSchema: applyWorldPatchInput,
      outputSchema: applyWorldPatchOutput,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) =>
      runTool("world_patch", async () => {
        const result = await applyWorldPatch(args, NO_ORIGIN)
        if (!result.ok) throw new ToolInputError(result.error)
        return structured(
          `world corrected · ${result.data.state.minutes} minutes`,
          result.data
        )
      })
  )
}
