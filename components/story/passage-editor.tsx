"use client"

import * as React from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

import { useMarkdownShortcuts } from "@/hooks/use-markdown-shortcuts"
import { updateActionEntry, updateEntryText } from "@/lib/actions/entries"
import type { StoryEntry } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

/**
 * Inline editing surface swapped in place of a passage's prose. The textarea
 * carries the exact manuscript type spec (and no padding/border of its own) so
 * the words don't move when the block flips between reading and editing.
 *
 * Two passages, two things to edit. A player turn (actionKind non-null) is
 * really its first-person input plus a derived translation, so the editor hands
 * back the input — what the writer actually typed — and saving re-runs the
 * transform. Everything else (generated passages, user passages older than
 * Say/Do) is only its prose, and edits it verbatim as it always has.
 */
export function PassageEditor({
  storyId,
  entry,
  onDone,
}: {
  storyId: string
  entry: StoryEntry
  onDone: () => void
}) {
  const action =
    entry.actionKind !== null && entry.inputText !== null
      ? { kind: entry.actionKind, inputText: entry.inputText }
      : null

  /**
   * The escape hatch. translateAction is deterministic and therefore wrong on
   * inputs it wasn't built for ("the guard turns around" becomes "You the guard
   * turns around."), and because a player turn re-translates on every save the
   * writer could otherwise never hand-fix one. Switching here abandons the
   * pairing: the passage is saved as plain prose and stops being a Say or a Do.
   */
  const [editingProse, setEditingProse] = React.useState(action === null)

  // Uncontrolled-after-mount (§4.2): seeded once, never resynced from props.
  // Switching to prose is the one thing that replaces the buffer, and it is a
  // deliberate click rather than a prop change, so the rule still holds.
  const [value, setValue] = React.useState(
    action ? action.inputText : entry.text
  )
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

  function switchToProse() {
    setEditingProse(true)
    setValue(entry.text)
    const el = textareaRef.current
    if (!el) return
    el.focus()
  }

  function save() {
    if (!canSave) return
    startTransition(async () => {
      // updateEntryText clears action_kind and input_text, so saving from the
      // escape hatch is what actually demotes the row to ordinary prose — the
      // hand-fixed sentence survives and nothing is left to re-translate it.
      const res =
        action !== null && !editingProse
          ? await updateActionEntry(storyId, entry.id, value)
          : await updateEntryText(storyId, entry.id, value)
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

  const editingInput = action !== null && !editingProse

  return (
    <div>
      <Textarea
        ref={textareaRef}
        rows={1}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
        disabled={isPending}
        aria-label={
          editingInput
            ? `Edit what you typed for this ${action.kind === "say" ? "Say" : "Do"}`
            : "Edit passage"
        }
        className="min-h-0 border-0 bg-transparent p-0 font-serif text-[1.0625rem] leading-8 text-foreground shadow-none disabled:opacity-100 md:text-[1.0625rem]"
      />
      <div className="mt-3 flex items-center justify-end gap-1.5">
        {editingInput && (
          // Quiet on purpose: it is the rare repair, not the normal edit. It
          // disappears once taken because the buffer has already been replaced
          // and there is nothing to switch back to — Esc and reopen for that.
          <Button
            variant="ghost"
            size="xs"
            className="mr-auto text-muted-foreground"
            onClick={switchToProse}
            disabled={isPending}
          >
            Edit prose instead
          </Button>
        )}
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
