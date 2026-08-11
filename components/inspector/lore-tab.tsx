import Link from "next/link"
import { ArrowUpRight, BookOpen } from "lucide-react"

import { LoreEntryCard } from "@/components/inspector/lore-entry-card"
import { buttonVariants } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  matchActiveLorebookEntries,
  recentStoryText,
} from "@/lib/generation/lorebook"
import type { LorebookEntry, Story } from "@/lib/types"

/**
 * Which lorebook entries are actually in context right now, and why.
 *
 * Matching is recomputed here (rather than reading `story.activeLorebookEntryIds`)
 * so each card can surface the trigger key that pulled the entry in. Read-only:
 * enabling, editing and deleting all live in the /lorebook route.
 */
export function LoreTab({
  story,
  lorebookEntries,
}: {
  story: Story
  lorebookEntries: LorebookEntry[]
}) {
  const matches = matchActiveLorebookEntries(
    lorebookEntries,
    recentStoryText(story.entries)
  )

  if (matches.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <BookOpen />
          </EmptyMedia>
          <EmptyTitle>No lore active</EmptyTitle>
          <EmptyDescription>
            Entries appear here when their trigger keys match recent story text.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Link
            href="/lorebook"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Open lorebook
          </Link>
        </EmptyContent>
      </Empty>
    )
  }

  return (
    <>
      <p className="text-xs text-muted-foreground">
        {matches.length} {matches.length === 1 ? "entry" : "entries"} in context
      </p>

      <div className="space-y-3">
        {matches.map((match) => (
          <LoreEntryCard key={match.entry.id} match={match} />
        ))}
      </div>

      <Link
        href="/lorebook"
        className={buttonVariants({ variant: "ghost", size: "xs" })}
      >
        Manage lorebook
        <ArrowUpRight data-icon="inline-end" />
      </Link>
    </>
  )
}
