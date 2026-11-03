import { worldOp, type WorldOp } from "@/lib/services/world.schema"

interface PatchRow {
  entryId: string | null
  source: "world" | "manual"
  opsJson: string
  createdAt: string
}

/**
 * Re-points a story's world patches at a copy's passages and lore. A patch on
 * a passage the copy left behind is dropped, as is any op naming lore with no
 * copy, so the copy folds to the same world the original reads today.
 */
export function copyWorldPatches(
  rows: readonly PatchRow[],
  storyId: string,
  entryIds: ReadonlyMap<string, string>,
  loreIds: ReadonlyMap<string, string>
) {
  return rows.flatMap((row) => {
    const entryId = row.entryId === null ? null : entryIds.get(row.entryId)
    if (entryId === undefined) return []
    let raw: unknown
    try {
      raw = JSON.parse(row.opsJson)
    } catch {
      return []
    }
    const parsed = worldOp.array().safeParse(raw)
    if (!parsed.success) return []
    const ops = parsed.data.flatMap((op): WorldOp[] => {
      if (!("loreEntryId" in op)) return [op]
      const loreEntryId = loreIds.get(op.loreEntryId)
      return loreEntryId ? [{ ...op, loreEntryId }] : []
    })
    if (ops.length === 0) return []
    return [
      {
        id: crypto.randomUUID(),
        storyId,
        entryId,
        source: row.source,
        opsJson: JSON.stringify(ops),
        createdAt: row.createdAt,
      },
    ]
  })
}
