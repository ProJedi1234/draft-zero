import type { LorebookEntry } from "@/lib/types"
import { MINUTES_PER_DAY, type WorldState } from "@/lib/services/world.schema"
import { isNpc } from "@/lib/world/fold"

export function worldTime(minutes: number): string {
  const day = Math.floor(minutes / MINUTES_PER_DAY) + 1
  const bucket = ["night", "morning", "afternoon", "evening"][
    Math.floor((minutes % MINUTES_PER_DAY) / 360)
  ]
  return `day ${day}, ${bucket}`
}

export function worldContext(
  state: WorldState,
  activeLore: readonly LorebookEntry[]
): string[] {
  const present = activeLore
    .filter(isNpc)
    .slice()
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))
    .slice(0, 4)
  return [
    `[World: ${worldTime(state.minutes)}]`,
    ...present.flatMap((entry) => {
      const npc = state.npcs.find((npc) => npc.loreEntryId === entry.id)
      if (!npc) return []
      const memories = npc.memories
        .map((memory, index) => ({ memory, index }))
        .sort(
          (a, b) =>
            b.memory.importance - a.memory.importance || b.index - a.index
        )
        .slice(0, 6)
        .sort((a, b) => a.index - b.index)
      return [
        `[${entry.name}, now]\nOn their mind: ${npc.mind}${memories.length ? `\nRemembers:\n${memories.map(({ memory }) => `- (day ${Math.floor(memory.minutes / MINUTES_PER_DAY) + 1}) ${memory.text}`).join("\n")}` : ""}`,
      ]
    }),
  ]
}
