"use client"

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
} from "react"
import { Loader2, Trash2, X } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { useAutosave } from "@/hooks/use-autosave"
import { useMarkdownShortcuts } from "@/hooks/use-markdown-shortcuts"
import {
  deleteLorebookEntry,
  updateLorebookEntry,
} from "@/lib/actions/lorebook"
import { formatRelativeDate } from "@/lib/format"
import {
  LOREBOOK_CATEGORIES,
  type LorebookCategory,
  type LorebookEntry,
  type NewLorebookEntry,
} from "@/lib/types"

/** A blank draft — the shape the create dialog starts from. */
export const EMPTY_LOREBOOK_DRAFT: NewLorebookEntry = {
  name: "",
  category: "character",
  keys: [],
  content: "",
  enabled: true,
  alwaysActive: false,
  priority: 50,
}

function draftFromEntry(entry?: LorebookEntry): NewLorebookEntry {
  if (!entry) return { ...EMPTY_LOREBOOK_DRAFT }
  return {
    name: entry.name,
    category: entry.category,
    keys: [...entry.keys],
    content: entry.content,
    enabled: entry.enabled,
    alwaysActive: entry.alwaysActive,
    priority: entry.priority,
  }
}

function pickSliderValue(value: number | readonly number[]): number {
  return typeof value === "number" ? value : value[0]
}

/**
 * The lorebook entry form.
 *
 * - `layout="page"` (with an `entry`): every change autosaves — text fields and
 *   trigger keys debounce through `useAutosave`, discrete controls (category,
 *   switches, priority commit) write immediately. Footer shows the live updated
 *   time plus a confirmed delete.
 * - `layout="dialog"`: no persistence at all. The draft lives locally and is
 *   reported upward through `onChange` so the create dialog can submit it.
 *
 * Text fields are uncontrolled after mount (§4.2); the parent keys this
 * component by `entry.id` so switching entries remounts it fresh.
 */
export function LorebookEntryEditor({
  entry,
  layout = "page",
  onChange,
}: {
  entry?: LorebookEntry
  layout?: "page" | "dialog"
  /** Called with the current draft whenever it changes (dialog layout). */
  onChange?: (draft: NewLorebookEntry) => void
}) {
  const uid = useId()
  const markdownShortcuts = useMarkdownShortcuts()
  const entryId = entry?.id
  const persists = layout === "page" && entryId !== undefined

  const [draft, setDraft] = useState<NewLorebookEntry>(() =>
    draftFromEntry(entry)
  )
  const [keyInput, setKeyInput] = useState("")
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [, startSave] = useTransition()
  const [deletePending, startDelete] = useTransition()

  // Report the draft upward (create dialog). Ref-held so a fresh callback
  // identity every render doesn't refire the effect.
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  })
  useEffect(() => {
    onChangeRef.current?.(draft)
  }, [draft])

  // Debounced writes accumulate into one patch so a name edit isn't lost when a
  // content edit supersedes the pending save.
  const pendingPatch = useRef<Partial<NewLorebookEntry>>({})

  const { schedule, flush } = useAutosave<Partial<NewLorebookEntry>>(
    useCallback(
      async (patch: Partial<NewLorebookEntry>) => {
        pendingPatch.current = {}
        if (!entryId) return { ok: true as const, data: null }
        const next = { ...patch }
        // Never persist a blank name — the field shows an inline hint instead of
        // toasting on every character the user clears.
        if (next.name !== undefined && next.name.trim() === "") delete next.name
        if (Object.keys(next).length === 0)
          return { ok: true as const, data: null }
        return updateLorebookEntry(entryId, next)
      },
      [entryId]
    )
  )

  const scheduleSave = useCallback(
    (patch: Partial<NewLorebookEntry>) => {
      if (!persists) return
      pendingPatch.current = { ...pendingPatch.current, ...patch }
      schedule(pendingPatch.current)
    },
    [persists, schedule]
  )

  const saveNow = useCallback(
    (patch: Partial<NewLorebookEntry>) => {
      if (!persists || !entryId) return
      startSave(async () => {
        const res = await updateLorebookEntry(entryId, patch)
        if (!res.ok) toast.error(res.error)
      })
    },
    [entryId, persists]
  )

  const flushIfPersisting = useCallback(() => {
    if (persists) flush()
  }, [flush, persists])

  function addKey(raw: string) {
    const key = raw.trim()
    setKeyInput("")
    if (key === "" || draft.keys.includes(key)) return
    const keys = [...draft.keys, key]
    setDraft((prev) => ({ ...prev, keys }))
    scheduleSave({ keys })
  }

  function removeKey(key: string) {
    const keys = draft.keys.filter((k) => k !== key)
    setDraft((prev) => ({ ...prev, keys }))
    scheduleSave({ keys })
  }

  function handleDelete() {
    if (!entryId) return
    startDelete(async () => {
      const res = await deleteLorebookEntry(entryId)
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      setConfirmOpen(false)
      toast.success("Entry deleted")
    })
  }

  const nameMissing = persists && draft.name.trim() === ""

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor={`${uid}-name`}>Name</Label>
        <Input
          id={`${uid}-name`}
          defaultValue={entry?.name ?? ""}
          placeholder="Name this entry..."
          onChange={(e) => {
            const name = e.target.value
            setDraft((prev) => ({ ...prev, name }))
            scheduleSave({ name })
          }}
          onBlur={flushIfPersisting}
        />
        {nameMissing && (
          <p className="text-xs text-destructive">
            Name is required — changes to it aren&apos;t saved while it&apos;s
            blank.
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label>Category</Label>
        <Select
          value={draft.category}
          onValueChange={(value) => {
            const category = value as LorebookCategory
            setDraft((prev) => ({ ...prev, category }))
            saveNow({ category })
          }}
          items={LOREBOOK_CATEGORIES.map((c) => ({
            value: c.value,
            label: c.label,
          }))}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LOREBOOK_CATEGORIES.map((c) => (
              <SelectItem key={c.value} value={c.value}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${uid}-key`}>Trigger keys</Label>
        <div className="flex flex-wrap items-center gap-1.5">
          {draft.keys.map((k) => (
            <Badge key={k} variant="secondary" className="gap-1">
              {k}
              <button
                type="button"
                onClick={() => removeKey(k)}
                aria-label={`Remove key ${k}`}
                className="-mr-0.5 cursor-pointer text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
          <Input
            id={`${uid}-key`}
            value={keyInput}
            placeholder="Add key..."
            className="h-8 w-28"
            aria-label="Add trigger key"
            // A key is matched against the story text literally, so a keyboard
            // that fixes spelling or capitalises the first word breaks the
            // match. `done` because Enter here commits the key, not the form.
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            enterKeyHint="done"
            onChange={(e) => setKeyInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault()
                addKey(keyInput)
                return
              }
              if (
                e.key === "Backspace" &&
                keyInput === "" &&
                draft.keys.length > 0
              ) {
                e.preventDefault()
                removeKey(draft.keys[draft.keys.length - 1])
              }
            }}
            onBlur={() => {
              addKey(keyInput)
              flushIfPersisting()
            }}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Entry activates when a key appears in recent story text.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${uid}-content`}>Content</Label>
        <Textarea
          id={`${uid}-content`}
          defaultValue={entry?.content ?? ""}
          className="min-h-40"
          placeholder="What should the model know?"
          onKeyDown={markdownShortcuts}
          onChange={(e) => {
            const content = e.target.value
            setDraft((prev) => ({ ...prev, content }))
            scheduleSave({ content })
          }}
          onBlur={flushIfPersisting}
        />
        <p className="text-xs text-muted-foreground">
          Injected into context when triggered. Supports **bold** and *italic*.
        </p>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div>
          <Label>Enabled</Label>
          <p className="text-xs text-muted-foreground">
            Disabled entries never enter context.
          </p>
        </div>
        <Switch
          checked={draft.enabled}
          onCheckedChange={(enabled) => {
            setDraft((prev) => ({ ...prev, enabled }))
            saveNow({ enabled })
          }}
          aria-label="Enabled"
        />
      </div>

      <div className="flex items-center justify-between gap-4">
        <div>
          <Label>Always active</Label>
          <p className="text-xs text-muted-foreground">
            Stay in context even without a key match.
          </p>
        </div>
        <Switch
          checked={draft.alwaysActive}
          onCheckedChange={(alwaysActive) => {
            setDraft((prev) => ({ ...prev, alwaysActive }))
            saveNow({ alwaysActive })
          }}
          aria-label="Always active"
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-4">
          <Label>Priority</Label>
          <span className="font-mono text-xs text-muted-foreground">
            {draft.priority}
          </span>
        </div>
        <Slider
          value={[draft.priority]}
          min={0}
          max={100}
          step={5}
          onValueChange={(value) => {
            const priority = pickSliderValue(value)
            setDraft((prev) => ({ ...prev, priority }))
          }}
          onValueCommitted={(value) => {
            const priority = pickSliderValue(value)
            setDraft((prev) => ({ ...prev, priority }))
            saveNow({ priority })
          }}
          aria-label="Priority"
        />
        <p className="text-xs text-muted-foreground">
          Higher priority survives context trimming longer.
        </p>
      </div>

      {layout === "page" && entry && (
        <div className="flex items-center justify-between border-t pt-4">
          <span className="text-xs text-muted-foreground">
            Updated {formatRelativeDate(entry.updatedAt)}
          </span>
          <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <DialogTrigger render={<Button variant="destructive" size="sm" />}>
              <Trash2 data-icon="inline-start" />
              Delete
            </DialogTrigger>
            <DialogContent className="sm:max-w-sm">
              <DialogHeader>
                <DialogTitle>Delete “{entry.name}”?</DialogTitle>
                <DialogDescription>
                  The entry is removed from the lorebook and from every story
                  context it feeds. This can&apos;t be undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose
                  render={
                    <Button variant="outline" size="sm">
                      Cancel
                    </Button>
                  }
                />
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={deletePending}
                  onClick={handleDelete}
                >
                  {deletePending ? (
                    <Loader2
                      data-icon="inline-start"
                      className="animate-spin"
                    />
                  ) : (
                    <Trash2 data-icon="inline-start" />
                  )}
                  Delete entry
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      )}
    </div>
  )
}
