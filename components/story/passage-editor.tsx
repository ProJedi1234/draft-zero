"use client"

import * as React from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

import { useMarkdownShortcuts } from "@/hooks/use-markdown-shortcuts"
import { updateEntryText } from "@/lib/actions/entries"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

/**
 * Inline editing surface swapped in place of a passage's prose. The textarea
 * carries the exact manuscript type spec (and no padding/border of its own) so
 * the words don't move when the block flips between reading and editing.
 */
export function PassageEditor({
  storyId,
  entryId,
  initialText,
  onDone,
}: {
  storyId: string
  entryId: string
  initialText: string
  onDone: () => void
}) {
  // Uncontrolled-after-mount (§4.2): seeded once, never resynced from props.
  const [value, setValue] = React.useState(initialText)
  const [isPending, startTransition] = React.useTransition()
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)
  const markdownShortcuts = useMarkdownShortcuts()

  const canSave = value.trim() !== "" && !isPending

  React.useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.focus()
    const end = el.value.length
    el.setSelectionRange(end, end)
  }, [])

  function save() {
    if (!canSave) return
    startTransition(async () => {
      const res = await updateEntryText(storyId, entryId, value)
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      onDone()
    })
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (markdownShortcuts(event)) return
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault()
      save()
      return
    }
    if (event.key === "Escape") {
      // Don't let Esc reach the canvas-level stop-generation handler.
      event.preventDefault()
      event.stopPropagation()
      if (!isPending) onDone()
    }
  }

  return (
    <div>
      <Textarea
        ref={textareaRef}
        rows={1}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
        disabled={isPending}
        aria-label="Edit passage"
        className="min-h-0 border-0 bg-transparent p-0 font-serif text-[1.0625rem] leading-8 text-foreground shadow-none disabled:opacity-100 md:text-[1.0625rem]"
      />
      <div className="mt-3 flex items-center justify-end gap-1.5">
        <Button variant="ghost" size="xs" onClick={onDone} disabled={isPending}>
          Cancel
        </Button>
        <Button size="xs" onClick={save} disabled={!canSave}>
          {isPending && (
            <Loader2 data-icon="inline-start" className="animate-spin" />
          )}
          Save
        </Button>
      </div>
    </div>
  )
}
