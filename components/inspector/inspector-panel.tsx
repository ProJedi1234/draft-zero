"use client"

import * as React from "react"
import { ChevronsUpDown } from "lucide-react"
import { toast } from "sonner"

import { LoreTab } from "@/components/inspector/lore-tab"
import { ModelPicker } from "@/components/inspector/model-picker"
import { SettingSlider } from "@/components/inspector/setting-slider"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { useAutosave, type SaveStatus } from "@/hooks/use-autosave"
import {
  updateGenerationSettings,
  updateStoryMeta,
} from "@/lib/actions/stories"
import { formatContextLength } from "@/lib/format"
import { composeContext } from "@/lib/generation/context"
import type { LorebookEntry, OpenRouterModel, Story } from "@/lib/types"
import { cn } from "@/lib/utils"

export function InspectorPanel({
  story,
  lorebookEntries,
  models,
  className,
}: {
  story: Story
  lorebookEntries: LorebookEntry[]
  models: OpenRouterModel[]
  className?: string
}) {
  return (
    <aside
      aria-label="Inspector"
      className={cn(
        "w-80 shrink-0 flex-col overflow-hidden border-l bg-background",
        className
      )}
    >
      <InspectorContent
        story={story}
        lorebookEntries={lorebookEntries}
        models={models}
      />
    </aside>
  )
}

/**
 * A DB-backed text field that is uncontrolled after mount (§4.2) but still
 * reconciles when the value changes *somewhere else* — the sidebar's Rename
 * dialog edits the same column as the Title field, and the mobile sheet mounts a
 * second copy of every field while the desktop panel stays mounted behind it.
 *
 * The rule: an incoming server value is written into the DOM only when this
 * field has no edit of its own in flight and is not focused. `pendingRef` holds
 * the last value this field wrote and is cleared once the props echo it back, so
 * a revalidation that predates our own save can never roll the field backwards.
 */
function useServerSyncedField<E extends HTMLInputElement | HTMLTextAreaElement>(
  ref: React.RefObject<E | null>,
  serverValue: string,
  status: SaveStatus
) {
  const pendingRef = React.useRef<string | null>(null)

  React.useEffect(() => {
    const el = ref.current
    if (!el) return

    const pending = pendingRef.current
    if (pending !== null) {
      // Our own write is still travelling; the server has caught up only when
      // it hands the same text back.
      if (serverValue === pending) pendingRef.current = null
      return
    }

    if (el === document.activeElement) return
    if (el.value === serverValue) return
    el.value = serverValue
  }, [ref, serverValue, status])

  /** Record what this field just wrote, so its own echo isn't mistaken for an external change. */
  const markWritten = React.useCallback((value: string) => {
    pendingRef.current = value
  }, [])

  /** Put the field back on the server value and forget the local edit. */
  const restore = React.useCallback(
    (value: string) => {
      pendingRef.current = null
      if (ref.current) ref.current.value = value
    },
    [ref]
  )

  return { markWritten, restore }
}

/**
 * Inspector sections without the aside chrome — shared by the desktop panel and
 * the mobile sheet. The `key` remounts every field, slider and the model picker
 * when the writer switches stories: inside, fields only ever resync from props
 * for changes made elsewhere (see useServerSyncedField), so a remount is the
 * only thing that resets the sliders and the model picker.
 */
export function InspectorContent({
  story,
  lorebookEntries,
  models,
}: {
  story: Story
  lorebookEntries: LorebookEntry[]
  models: OpenRouterModel[]
}) {
  return (
    <InspectorSections
      key={story.id}
      story={story}
      lorebookEntries={lorebookEntries}
      models={models}
    />
  )
}

function InspectorSections({
  story,
  lorebookEntries,
  models,
}: {
  story: Story
  lorebookEntries: LorebookEntry[]
  models: OpenRouterModel[]
}) {
  // Unique per mounted instance: the desktop panel and the mobile sheet can be
  // in the DOM at once, and duplicate ids would cross-wire the labels.
  const uid = React.useId()
  const [modelId, setModelId] = React.useState(story.settings.modelId)
  const [titleEmpty, setTitleEmpty] = React.useState(false)
  const [, startTransition] = React.useTransition()

  const titleSave = useAutosave((value: string) =>
    updateStoryMeta(story.id, { title: value })
  )
  const descriptionSave = useAutosave((value: string) =>
    updateStoryMeta(story.id, { description: value })
  )
  const genreSave = useAutosave((value: string) =>
    updateStoryMeta(story.id, { genre: value })
  )
  const memorySave = useAutosave((value: string) =>
    updateStoryMeta(story.id, { memory: value })
  )
  const authorsNoteSave = useAutosave((value: string) =>
    updateStoryMeta(story.id, { authorsNote: value })
  )

  const titleRef = React.useRef<HTMLInputElement>(null)
  const descriptionRef = React.useRef<HTMLTextAreaElement>(null)
  const genreRef = React.useRef<HTMLInputElement>(null)
  const memoryRef = React.useRef<HTMLTextAreaElement>(null)
  const authorsNoteRef = React.useRef<HTMLTextAreaElement>(null)

  const titleField = useServerSyncedField(
    titleRef,
    story.title,
    titleSave.status
  )
  const descriptionField = useServerSyncedField(
    descriptionRef,
    story.description,
    descriptionSave.status
  )
  const genreField = useServerSyncedField(
    genreRef,
    story.genre,
    genreSave.status
  )
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

  function handleModelChange(nextModelId: string) {
    setModelId(nextModelId)
    startTransition(async () => {
      const result = await updateGenerationSettings(story.id, {
        modelId: nextModelId,
      })
      if (!result.ok) toast.error(result.error)
    })
  }

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="space-y-6 p-4">
        <div className="space-y-3">
          <div className="space-y-1">
            <ModelPicker
              models={models}
              value={modelId}
              onValueChange={handleModelChange}
            />
            <Collapsible>
              <CollapsibleTrigger
                render={
                  <Button
                    variant="ghost"
                    size="xs"
                    className="w-full justify-between text-muted-foreground"
                  />
                }
              >
                Generation settings
                <ChevronsUpDown className="size-3" />
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-6 pt-4">
                <SettingSlider
                  storyId={story.id}
                  field="temperature"
                  label="Temperature"
                  defaultValue={story.settings.temperature}
                  min={0}
                  max={2}
                  step={0.01}
                />
                <SettingSlider
                  storyId={story.id}
                  field="topP"
                  label="Top P"
                  defaultValue={story.settings.topP}
                  min={0}
                  max={1}
                  step={0.01}
                />
                <SettingSlider
                  storyId={story.id}
                  field="maxTokens"
                  label="Max tokens"
                  defaultValue={story.settings.maxTokens}
                  min={128}
                  max={4096}
                  step={128}
                />
                <SettingSlider
                  storyId={story.id}
                  field="frequencyPenalty"
                  label="Frequency penalty"
                  defaultValue={story.settings.frequencyPenalty}
                  min={-2}
                  max={2}
                  step={0.1}
                />
                <SettingSlider
                  storyId={story.id}
                  field="presencePenalty"
                  label="Presence penalty"
                  defaultValue={story.settings.presencePenalty}
                  min={-2}
                  max={2}
                  step={0.1}
                />
              </CollapsibleContent>
            </Collapsible>
          </div>

          <ContextMeter
            story={story}
            lorebookEntries={lorebookEntries}
            contextLength={
              models.find((m) => m.id === modelId)?.contextLength ?? 0
            }
          />
        </div>

        <Separator />

        <div className="space-y-2">
          <Label htmlFor={`${uid}-title`}>Title</Label>
          <Input
            id={`${uid}-title`}
            ref={titleRef}
            defaultValue={story.title}
            aria-invalid={titleEmpty || undefined}
            placeholder="Untitled Story"
            onChange={(event) => {
              const next = event.target.value
              const empty = next.trim() === ""
              setTitleEmpty(empty)
              if (empty) {
                // An empty title is rejected by the action, and the half-deleted
                // value still sitting in the debounce must not outlive it —
                // blur (or navigation) would otherwise persist "S".
                titleSave.cancel()
                return
              }
              titleField.markWritten(next)
              titleSave.schedule(next)
            }}
            onBlur={() => {
              const el = titleRef.current
              if (el && el.value.trim() === "") {
                // Nothing was saved for the empty value: put the stored title
                // back so the field, the header and the library agree.
                titleField.restore(story.title)
                setTitleEmpty(false)
                return
              }
              titleSave.flush()
            }}
          />
          <p className="text-xs text-muted-foreground">
            {titleEmpty
              ? "A title is required."
              : "Shown in the library and the story header."}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${uid}-description`}>Description</Label>
          <Textarea
            id={`${uid}-description`}
            ref={descriptionRef}
            defaultValue={story.description}
            className="min-h-16"
            placeholder="A sentence or two about this story…"
            onChange={(event) => {
              descriptionField.markWritten(event.target.value)
              descriptionSave.schedule(event.target.value)
            }}
            onBlur={() => descriptionSave.flush()}
          />
          <p className="text-xs text-muted-foreground">
            The pitch shown beside the story in the library.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${uid}-genre`}>Genre</Label>
          <Input
            id={`${uid}-genre`}
            ref={genreRef}
            defaultValue={story.genre}
            placeholder="Literary fiction"
            onChange={(event) => {
              genreField.markWritten(event.target.value)
              genreSave.schedule(event.target.value)
            }}
            onBlur={() => genreSave.flush()}
          />
          <p className="text-xs text-muted-foreground">
            Used for the library badge and search.
          </p>
        </div>

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

        <Separator />

        <div className="space-y-3">
          <Label>Lorebook</Label>
          <LoreTab story={story} lorebookEntries={lorebookEntries} />
        </div>
      </div>
    </ScrollArea>
  )
}

/** 812 -> "812"; 1234 -> "1.2K"; 24000 -> "24K". */
function formatApproxTokens(tokens: number): string {
  if (tokens >= 10_000) return formatContextLength(tokens)
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`
  return `${tokens}`
}

/**
 * How much of the selected model's window the next request would occupy.
 * Composed client-side from the same pure function the server uses to build the
 * real prompt, so the number the writer sees is the number that gets sent.
 */
function ContextMeter({
  story,
  lorebookEntries,
  contextLength,
}: {
  story: Story
  lorebookEntries: LorebookEntry[]
  /** Selected model's window; 0 when the model is unknown to the catalog. */
  contextLength: number
}) {
  const approxTokens = React.useMemo(
    () => composeContext({ story, lorebookEntries }).approxTokens,
    [story, lorebookEntries]
  )
  const ratio =
    contextLength > 0 ? Math.min(1, approxTokens / contextLength) : 0

  return (
    <div className="space-y-1.5">
      <p className="font-mono text-xs text-muted-foreground tabular-nums">
        ≈ {formatApproxTokens(approxTokens)}
        {contextLength > 0
          ? ` / ${formatContextLength(contextLength)}`
          : ""}{" "}
        tokens
      </p>
      {contextLength > 0 ? (
        <div
          className="h-0.5 w-full overflow-hidden bg-muted"
          role="progressbar"
          aria-label="Context used"
          aria-valuemin={0}
          aria-valuemax={contextLength}
          aria-valuenow={approxTokens}
        >
          <div
            className="h-full bg-primary transition-[width] duration-200"
            style={{ width: `${ratio * 100}%` }}
          />
        </div>
      ) : null}
    </div>
  )
}
