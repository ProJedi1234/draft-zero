"use client"

import * as React from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

import { useMarkdownShortcuts } from "@/hooks/use-markdown-shortcuts"
import { updateActionEntry, updateEntryText } from "@/lib/actions/entries"
import type { StoryEntry } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

/** Unsaved editor text, per passage, for the length of the browser session. */
const DRAFT_STORAGE_PREFIX = "draft-zero:passage-draft:"

/** Which buffer the draft belongs to: the prose, or a player turn's input. */
type SavedDraft = { prose: boolean; value: string }

function readDraft(entryId: string): SavedDraft | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.sessionStorage.getItem(DRAFT_STORAGE_PREFIX + entryId)
    if (raw === null) return null
    const parsed = JSON.parse(raw) as SavedDraft
    return typeof parsed?.value === "string" ? parsed : null
  } catch {
    return null
  }
}

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

  // An unsaved draft left by an editor this component never got to close: a
  // remote Retry or a tree refresh unmounts the open editor mid-edit, and the
  // buffer below is bare state. A draft for the input half of a row that has
  // since been demoted to plain prose matches nothing and is discarded.
  const [restored] = React.useState(() => {
    const saved = readDraft(entry.id)
    if (saved !== null && !saved.prose && action === null) return null
    return saved
  })

  /**
   * The escape hatch. translateAction is deterministic and therefore wrong on
   * inputs it wasn't built for ("the guard turns around" becomes "You the guard
   * turns around."), and because a player turn re-translates on every save the
   * writer could otherwise never hand-fix one. Switching here abandons the
   * pairing: the passage is saved as plain prose and stops being a Say or a Do.
   */
  const [editingProse, setEditingProse] = React.useState(
    action === null || (restored?.prose ?? false)
  )

  // Uncontrolled-after-mount (§4.2): seeded once, never resynced from props.
  // Switching to prose is the one thing that replaces the buffer, and it is a
  // deliberate click rather than a prop change, so the rule still holds.
  const [value, setValue] = React.useState(
    restored?.value ?? (action ? action.inputText : entry.text)
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

  // Same bargain as the composer's useDraftPersistence: an unmount this
  // component doesn't control (a Retry from another device hides the entry,
  // a refresh drops the row) must not be the end of unsaved words. Written
  // per keystroke, kept across unmount, and removed the moment the buffer
  // matches the row again — only a save or an explicit cancel discards it.
  const pristine = editingProse ? entry.text : (action?.inputText ?? "")
  React.useEffect(() => {
    const key = DRAFT_STORAGE_PREFIX + entry.id
    if (value === pristine) window.sessionStorage.removeItem(key)
    else
      window.sessionStorage.setItem(
        key,
        JSON.stringify({ prose: editingProse, value } satisfies SavedDraft)
      )
  }, [editingProse, entry.id, pristine, value])

  function discardDraft() {
    window.sessionStorage.removeItem(DRAFT_STORAGE_PREFIX + entry.id)
  }

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
      discardDraft()
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
      if (!isPending) {
        // Esc is the writer's own discard — unlike an unmount, it may drop
        // the draft.
        discardDraft()
        onDone()
      }
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
        // Precautionary, and untested against the bug: this editor's labels
        // never contained the token that tripped Safari on the composer, so it
        // was probably never misclassified. Prose is prose, though, and it costs
        // nothing to say so here too. See the note on the composer.
        autoComplete="off"
        autoCorrect="on"
        autoCapitalize="sentences"
        spellCheck
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
        <Button
          variant="ghost"
          size="xs"
          onClick={() => {
            discardDraft()
            onDone()
          }}
          disabled={isPending}
        >
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
