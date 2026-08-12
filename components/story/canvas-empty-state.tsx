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

// Written in the first person the description asks for, because the chips prime
// the composer rather than sending it: the writer sees exactly what they would
// have typed themselves, and the transform to "You look around." happens on
// submit. They are Do openings, so clicking one arms Do.
const SUGGESTIONS = ["I look around", "I check my pockets", "I call out"]

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
          Open &ldquo;{story.title}&rdquo; with your first move. Write what you
          do, or what you say, in first person — it lands on the page in second.
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
