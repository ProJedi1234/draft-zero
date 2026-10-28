import type { LorebookEntry } from "@/lib/types"
import type { WorldOp, WorldState } from "@/lib/services/world.schema"

export interface WorldEntry {
  id: string
  position: number
  isActive: boolean
  deletedAt: string | null
}

export interface WorldPatch {
  id: string
  source: "world" | "manual"
  entryId: string | null
  ops: WorldOp[]
  createdAt: string
}

export function isNpc(entry: Pick<LorebookEntry, "npc" | "category">): boolean {
  return entry.npc && entry.category === "character"
}

/** Identify the immutable inputs a delayed world answer was based on. */
export function worldPrefix(
  entries: readonly WorldEntry[],
  patches: readonly WorldPatch[],
  position: number
) {
  const prefix = entries
    .filter((e) => e.isActive && e.deletedAt === null && e.position < position)
    .slice()
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
  const ids = new Set(prefix.map((e) => e.id))
  const folded = patches.filter((p) => p.entryId === null || ids.has(p.entryId))
  return {
    entries: prefix,
    patches: folded,
    revision: JSON.stringify([
      prefix.map((e) => e.id),
      folded.map((p) => p.id).sort(),
    ]),
  }
}

/** Rebuild from live takes so the manuscript's journal alone controls history. */
export function foldWorld(
  storyId: string,
  entries: readonly WorldEntry[],
  lore: readonly LorebookEntry[],
  patches: readonly WorldPatch[]
): WorldState {
  const live = new Map(
    entries
      .filter((e) => e.isActive && e.deletedAt === null)
      .map((e) => [e.id, e.position])
  )
  const npcs = lore
    .filter(isNpc)
    .map((e) => ({
      loreEntryId: e.id,
      name: e.name,
      mind: "",
      memories: [] as WorldState["npcs"][number]["memories"],
    }))
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name) ||
        a.loreEntryId.localeCompare(b.loreEntryId)
    )
  const byId = new Map(npcs.map((npc) => [npc.loreEntryId, npc]))
  const ordered = patches
    .filter((p) => p.entryId === null || live.has(p.entryId))
    .slice()
    .sort((a, b) => {
      if (a.entryId === null && b.entryId !== null) return -1
      if (a.entryId !== null && b.entryId === null) return 1
      return (
        (a.entryId === null
          ? 0
          : live.get(a.entryId)! - live.get(b.entryId!)!) ||
        (a.source === b.source ? 0 : a.source === "world" ? -1 : 1) ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.id.localeCompare(b.id)
      )
    })
  let minutes = 0
  for (const patch of ordered) {
    for (const op of patch.ops) {
      if (op.type === "advance-clock") {
        minutes += op.minutes
        continue
      }
      if (op.type === "set-clock") {
        minutes = op.minutes
        continue
      }
      const npc = byId.get(op.loreEntryId)
      if (!npc) continue
      switch (op.type) {
        case "set-mind":
          npc.mind = op.mind
          break
        case "add-memory":
          npc.memories.push({ ...op.memory, minutes, entryId: patch.entryId })
          break
        case "strike-memory":
          npc.memories = npc.memories.filter((m) => m.id !== op.memoryId)
          break
      }
    }
  }
  return { storyId, minutes, npcs }
}
