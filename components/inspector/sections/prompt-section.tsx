"use client"

import * as React from "react"
import { ChevronRight } from "lucide-react"

import { NarratorDialog } from "@/components/inspector/narrator-dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useAutosave } from "@/hooks/use-autosave"
import { useServerSyncedField } from "@/hooks/use-server-synced"
import { updateStoryMeta } from "@/lib/actions/stories"
import type { Story } from "@/lib/types"

/**
 * What the model reads: the two blocks of prose the writer keeps, plus the
 * narrator prompt that frames them.
 *
 * Self-contained — nothing outside needs these values, so the autosaves and the
 * fields that follow the server live here rather than in the panel.
 */
export function PromptSection({ story }: { story: Story }) {
  // Unique per mounted instance: the desktop panel and the mobile sheet can be
  // in the DOM at once, and duplicate ids would cross-wire the labels.
  const uid = React.useId()
  const [narratorOpen, setNarratorOpen] = React.useState(false)

  const memorySave = useAutosave((value: string) =>
    updateStoryMeta(story.id, { memory: value })
  )
  const authorsNoteSave = useAutosave((value: string) =>
    updateStoryMeta(story.id, { authorsNote: value })
  )

  const memoryRef = React.useRef<HTMLTextAreaElement>(null)
  const authorsNoteRef = React.useRef<HTMLTextAreaElement>(null)

  const memoryField = useServerSyncedField(
    memoryRef,
    story.memory,
    memorySave.status
  )
  const authorsNoteField = useServerSyncedField(
    authorsNoteRef,
    story.authorsNote,
    authorsNoteSave.status
  )

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor={`${uid}-memory`}>Memory</Label>
        <Textarea
          id={`${uid}-memory`}
          ref={memoryRef}
          defaultValue={story.memory}
          className="min-h-24"
          placeholder="Facts the model should always remember…"
          onChange={(event) => {
            memoryField.markWritten(event.target.value)
            memorySave.schedule(event.target.value)
          }}
          onBlur={() => memorySave.flush()}
        />
        <p className="text-xs text-muted-foreground">
          Always included at the top of context.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${uid}-authors-note`}>Author&apos;s note</Label>
        <Textarea
          id={`${uid}-authors-note`}
          ref={authorsNoteRef}
          defaultValue={story.authorsNote}
          className="min-h-16"
          placeholder="Steer tone and style…"
          onChange={(event) => {
            authorsNoteField.markWritten(event.target.value)
            authorsNoteSave.schedule(event.target.value)
          }}
          onBlur={() => authorsNoteSave.flush()}
        />
        <p className="text-xs text-muted-foreground">
          Injected near the most recent words.
        </p>
      </div>

      {/* One line, because the editor is a dialog now: a 48-row monospace box
          never belonged in a 320px column, and the built-in prompt it is
          compared against was unreadable at that width. */}
      <Button
        variant="ghost"
        size="xs"
        className="w-full justify-between text-muted-foreground"
        onClick={() => setNarratorOpen(true)}
      >
        Narrator
        <span className="flex items-center gap-1.5">
          <span className="font-mono text-[0.6875rem]">
            {story.systemPrompt === null ? "Built-in" : "Custom"}
          </span>
          <ChevronRight className="size-3" />
        </span>
      </Button>

      <NarratorDialog
        storyId={story.id}
        systemPrompt={story.systemPrompt}
        open={narratorOpen}
        onOpenChange={setNarratorOpen}
      />
    </div>
  )
}
