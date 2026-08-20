"use client"

import { LoreTab } from "@/components/inspector/lore-tab"
import { Label } from "@/components/ui/label"
import type { LorebookEntry, Story } from "@/lib/types"

/**
 * Which lorebook entries the recent story text has pulled into context, and
 * which key pulled each one. Read-only by design: enabling, editing and
 * deleting all live in the story's lorebook route.
 */
export function LoreSection({
  story,
  lorebookEntries,
}: {
  story: Story
  lorebookEntries: LorebookEntry[]
}) {
  return (
    <div className="space-y-3">
      <Label>Lorebook</Label>
      <LoreTab story={story} lorebookEntries={lorebookEntries} />
    </div>
  )
}
