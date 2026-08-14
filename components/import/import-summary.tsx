// components/import/import-summary.tsx — The shared bits of every import
// confirmation dialog.
//
// The readers stay uncoupled on purpose — a NovelAI scenario and an AI Dungeon
// card file have nothing to say to each other — but what the dialogs *show* is
// the same thing three times: a label/value row, a field's size, and a
// breakdown over the one shared LOREBOOK_CATEGORIES list. Kept here so the two
// card previews can't quietly disagree about the same file.

import { LOREBOOK_CATEGORIES, type NewLorebookEntry } from "@/lib/types"

/** One row of an import preview's definition list. */
export function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate">{value}</dd>
    </>
  )
}

/** Word count for a field, or "Empty" — enough to see what a file carries. */
export function summarize(text: string): string {
  const trimmed = text.trim()
  if (trimmed === "") return "Empty"
  const words = trimmed.split(/\s+/).length
  return `${words} ${words === 1 ? "word" : "words"}`
}

/**
 * ["8 Locations", "3 Characters"] in the app's own category order — an import's
 * types are remapped onto our six, and this is where a writer sees where they
 * landed before committing. Callers join it or render it as badges.
 */
export function categoryBreakdown(entries: NewLorebookEntry[]): string[] {
  return LOREBOOK_CATEGORIES.filter((category) =>
    entries.some((entry) => entry.category === category.value)
  ).map((category) => {
    const count = entries.filter(
      (entry) => entry.category === category.value
    ).length
    return `${count} ${count === 1 ? category.label : category.pluralLabel}`
  })
}
