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

// Model-written text must stay one line with no brackets, or it could open a
// fake prompt section such as "[Author's note]".
function narratorText(text: string): string {
  return text
    .replace(/[\s\u0085\u2028\u2029]+/g, " ")
    .replace(/[[［【〔〖⟦]/g, "(")
    .replace(/[\]］】〕〗⟧]/g, ")")
    .trim()
}

function npcBlock(
  name: string,
  mind: string,
  memories: WorldState["npcs"][number]["memories"]
): string {
  const lines = memories.map(
    (memory) =>
      `- (day ${Math.floor(memory.minutes / MINUTES_PER_DAY) + 1}) ${narratorText(memory.text)}`
  )
  return `[${narratorText(name)}, now]\nOn their mind: ${narratorText(mind)}${lines.length ? `\nRemembers:\n${lines.join("\n")}` : ""}`
}

/**
 * The narrator's world blocks, within `maxChars`. An NPC that does not fit
 * loses its least important memories first, then its block.
 */
export function worldContext(
  state: WorldState,
  activeLore: readonly LorebookEntry[],
  maxChars = Infinity
): string[] {
  const present = activeLore
    .filter(isNpc)
    .slice()
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))
    .slice(0, 4)
  const clock = `[World: ${worldTime(state.minutes)}]`
  const blocks = [clock]
  let left = maxChars - clock.length
  for (const entry of present) {
    const npc = state.npcs.find((npc) => npc.loreEntryId === entry.id)
    if (!npc) continue
    const ranked = npc.memories
      .map((memory, index) => ({ memory, index }))
      .sort(
        (a, b) => b.memory.importance - a.memory.importance || b.index - a.index
      )
      .slice(0, 6)
    for (let keep = ranked.length; keep >= 0; keep--) {
      const memories = ranked
        .slice(0, keep)
        .sort((a, b) => a.index - b.index)
        .map(({ memory }) => memory)
      const block = npcBlock(entry.name, npc.mind, memories)
      // +1 for the separator between blocks.
      if (block.length + 1 <= left) {
        blocks.push(block)
        left -= block.length + 1
        break
      }
    }
  }
  return blocks
}
