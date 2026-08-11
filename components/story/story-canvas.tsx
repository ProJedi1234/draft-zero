import type { Story } from "@/lib/types"
import { formatDateShort } from "@/lib/format"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { CanvasEmptyState } from "@/components/story/canvas-empty-state"
import { StoryEntryBlock } from "@/components/story/story-entry-block"

export function StoryCanvas({ story }: { story: Story }) {
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="mx-auto w-full max-w-2xl px-6 pt-12 pb-56">
        <div className="mb-2 flex items-center gap-2">
          <Badge variant="outline">{story.genre}</Badge>
          <span className="text-xs text-muted-foreground">
            Started {formatDateShort(story.createdAt)}
          </span>
        </div>
        <h2 className="font-serif text-3xl font-semibold tracking-tight">
          {story.title}
        </h2>
        {story.description && (
          <p className="mt-2 font-serif text-base leading-7 italic text-muted-foreground">
            {story.description}
          </p>
        )}
        <Separator className="mx-auto my-10 w-16" />

        {story.entries.length === 0 ? (
          <CanvasEmptyState story={story} />
        ) : (
          <>
            <div className="space-y-1">
              {story.entries.map((entry) => (
                <StoryEntryBlock key={entry.id} entry={entry} />
              ))}
            </div>
            <div
              aria-hidden
              className="mt-6 h-5 w-0.5 animate-pulse bg-primary/50"
            />
          </>
        )}
      </div>
    </ScrollArea>
  )
}
