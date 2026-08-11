"use client"

import { Feather } from "lucide-react"

import type { Story } from "@/lib/types"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"

const SUGGESTIONS = [
  "Open on a storm rolling in",
  "Start mid-argument",
  "Describe the place your hero calls home",
]

export function CanvasEmptyState({
  story,
  onSuggestion,
}: {
  story: Story
  /** Inserts the chip text into the composer and focuses it — never auto-sends. */
  onSuggestion: (text: string) => void
}) {
  return (
    <Empty className="py-16">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Feather />
        </EmptyMedia>
        <EmptyTitle>A blank page, full of possibility</EmptyTitle>
        <EmptyDescription>
          Start &ldquo;{story.title}&rdquo; by writing an opening line below —
          or describe a scene and let the model take it from there.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <div className="flex flex-wrap justify-center gap-2">
          {SUGGESTIONS.map((suggestion) => (
            <Button
              key={suggestion}
              variant="outline"
              size="xs"
              onClick={() => onSuggestion(suggestion)}
            >
              {suggestion}
            </Button>
          ))}
        </div>
      </EmptyContent>
    </Empty>
  )
}
