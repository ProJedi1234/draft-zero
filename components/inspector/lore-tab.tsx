import Link from "next/link"
import { ArrowUpRight, BookOpen } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { getActiveLorebookEntries } from "@/lib/mock-data"
import type { Story } from "@/lib/types"

export function LoreTab({ story }: { story: Story }) {
  const entries = getActiveLorebookEntries(story)

  if (entries.length === 0) {
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
          <Button variant="outline" size="sm" render={<Link href="/lorebook" />}>
            Open lorebook
          </Button>
        </EmptyContent>
      </Empty>
    )
  }

  return (
    <>
      <p className="text-xs text-muted-foreground">
        {entries.length} entries in context
      </p>

      <div className="space-y-3">
        {entries.map((entry) => (
          <div key={entry.id} className="space-y-1.5 border p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-medium">{entry.name}</span>
              <Badge variant="outline" className="shrink-0 capitalize">
                {entry.category}
              </Badge>
            </div>
            <div className="flex flex-wrap gap-1">
              {entry.keys.map((k) => (
                <Badge key={k} variant="secondary" className="text-[10px]">
                  {k}
                </Badge>
              ))}
            </div>
            <p className="line-clamp-2 text-xs text-muted-foreground">
              {entry.content}
            </p>
          </div>
        ))}
      </div>

      <Button variant="ghost" size="xs" render={<Link href="/lorebook" />}>
        Manage lorebook
        <ArrowUpRight data-icon="inline-end" />
      </Button>
    </>
  )
}
