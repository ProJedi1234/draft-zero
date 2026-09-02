"use client"

import * as React from "react"
import {
  ArrowUp,
  FastForward,
  ImagePlus,
  Loader2,
  MessageSquareQuote,
  Palette,
  PenLine,
  RectangleHorizontal,
  Redo2,
  Sparkles,
  RotateCcw,
  Square,
  Swords,
  Undo2,
  X,
  WandSparkles,
} from "lucide-react"

import {
  IMAGE_ASPECT_RATIOS,
  type ComposerMode,
  type ImageAspectRatio,
} from "@/lib/types"
import type { LoreMatch } from "@/lib/generation/lorebook"
import { IMAGE_STYLE_PRESETS } from "@/lib/images/styles"
import type { GenerationStatus } from "@/hooks/use-generation"
import { cn } from "@/lib/utils"
import { useMarkdownShortcuts } from "@/hooks/use-markdown-shortcuts"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { RetryButton } from "@/components/story/retry-profile-menu"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

/**
 * What the composer can be armed to do. A segmented row rather than a dropdown
 * because which one is armed changes what every keystroke means, and that has
 * to be readable without opening anything.
 *
 * Image sits beside the two moves rather than somewhere else entirely because
 * it is the same gesture — type, send, something appears at the end of the
 * manuscript — and a picture is a beat in the story, not a property of a
 * passage.
 */
const MODES = [
  {
    value: "do",
    label: "Do",
    icon: Swords,
    placeholder: "What do you do?",
  },
  {
    value: "say",
    label: "Say",
    icon: MessageSquareQuote,
    placeholder: "What do you say?",
  },
  {
    value: "image",
    label: "Image",
    icon: ImagePlus,
    // The brief's placeholder, not a prompt's: what goes here is shorthand in
    // the writer's own words, and asking for a "description" invites them to do
    // the work the develop call exists to do for them.
    placeholder: "What's the picture? A few words is plenty…",
  },
] as const

/** The image mode's placeholder when assistance is off — nothing expands it. */
const VERBATIM_PLACEHOLDER = "Describe the image…"

/**
 * One string for one mute set, so "same mutes?" is an equality check. Order
 * and duplicates are presentation noise, not different questions.
 */
function loreMuteKey(ids: Iterable<string>): string {
  return [...new Set(ids)].sort().join("\n")
}

/**
 * One tappable word on the caption line. h-7 is the same target the lore chips
 * use — the smallest that stays comfortable under a thumb without turning a
 * line of words into a row of buttons — and the muted default lets the two
 * settings that are ON (a chosen style, assistance) come forward on their own.
 */
const CAPTION_ITEM =
  "inline-flex h-7 items-center gap-1.5 px-2 text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-50"

/** The dot between two caption words. Punctuation, so it is hidden from AT. */
function CaptionSeparator() {
  return (
    <span aria-hidden className="px-0.5 text-muted-foreground/40">
      ·
    </span>
  )
}

/** The icon rotation that shows a frame's shape rather than naming it. */
const ASPECT_ICON_ROTATION: Record<ImageAspectRatio, string> = {
  "16:9": "",
  "1:1": "scale-x-75",
  "9:16": "rotate-90",
}

export function Composer({
  value,
  onValueChange,
  mode,
  onModeChange,
  aspectRatio,
  onAspectRatioChange,
  imagePrompt,
  onImagePromptChange,
  imageAssisted,
  onImageAssistedChange,
  imageStyle,
  onImageStyleChange,
  loreMatches,
  includedLoreIds,
  excludedLoreIds,
  onToggleLore,
  deriving,
  derivedBrief,
  derivedExcludedLoreIds,
  markDevelopedRef,
  onDevelop,
  onGenerateImage,
  imageBusy,
  textareaRef,
  containerRef,
  status,
  busy,
  canUndo,
  canRedo,
  canRetry,
  undoLabel,
  redoLabel,
  onSend,
  onContinue,
  onRetry,
  onUndo,
  onRedo,
  onStop,
}: {
  value: string
  onValueChange: (value: string) => void
  /** Per-story, synced, and seeded from the draft row — see StoryEditor. */
  mode: ComposerMode
  onModeChange: (mode: ComposerMode) => void
  /** The frame the next image is asked for in. Remembered across sends. */
  aspectRatio: ImageAspectRatio
  onAspectRatioChange: (ratio: ImageAspectRatio) => void
  /**
   * The developed prompt under the brief, or null when there is none. Null and
   * "" are different states here: "" is a develop call that has started and not
   * yet produced a word, which is why the lane is already on screen.
   */
  imagePrompt: string | null
  /** A hand-edit of the lane. Published and persisted, unlike the stream. */
  onImagePromptChange: (value: string | null) => void
  /** False is verbatim: no develop call, one beat, the words go as typed. */
  imageAssisted: boolean
  onImageAssistedChange: (assisted: boolean) => void
  /** The art direction appended to the next send, or null for none. */
  imageStyle: string | null
  onImageStyleChange: (style: string | null) => void
  /** What the brief currently matches in the lorebook — one chip each. */
  loreMatches: LoreMatch[]
  /**
   * What the develop call will actually carry — the workspace's budgeted
   * selection, recorded on the draw. Kept beside `loreMatches` rather than
   * derived here so the ids sent are the route's own arithmetic, not a second
   * copy of it.
   */
  includedLoreIds: string[]
  /** Chips the writer muted. Per-send: the workspace clears them on a draw. */
  excludedLoreIds: ReadonlySet<string>
  onToggleLore: (id: string) => void
  /**
   * True while a develop is streaming into the lane — on EVERY device on the
   * story, not only the one that asked. The develop is a server-owned run, so
   * this composer locks and shows the prompt writing itself whether the tap
   * happened here or on the writer's phone.
   */
  deriving: boolean
  /**
   * The brief the live — or most recently finished — develop is answering, or
   * null if this device has not seen one. Not the same thing as `value`: a
   * device that attached mid-run never typed the brief, and dating the answer
   * to its own empty textarea would mark a perfectly fresh lane stale.
   */
  derivedBrief: string | null
  /**
   * The mutes that brief was asked under, or null before any run — the other
   * half of the question the lane answers, read at the same falling edge.
   */
  derivedExcludedLoreIds: string[] | null
  /**
   * The workspace's bridge into the staleness mark: restoring a picture's
   * brief/prompt pair calls through with the restored brief (null to clear) so
   * the already-paid-for lane offers Draw instead of a second develop.
   */
  markDevelopedRef: {
    current: ((developedForBrief: string | null) => void) | null
  }
  /**
   * Expands the brief into the lane, or — with an empty brief — derives from
   * where the story is now. A real, billed call either way, which is why it is
   * always a keystroke or a tap the writer made and never a mode change.
   */
  onDevelop: () => void
  /** Sends to the image provider. `scene` is the text; the rest is provenance. */
  onGenerateImage: (send: {
    scene: string
    sourcePrompt: string | null
    loreIds: string[]
  }) => void
  /** True while an illustration is being drawn. */
  imageBusy: boolean
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  /** The floating panel, measured by the workspace to reserve canvas padding. */
  containerRef?: React.RefObject<HTMLDivElement | null>
  status: GenerationStatus
  busy: boolean
  canUndo: boolean
  canRedo: boolean
  canRetry: boolean
  /**
   * What the two buttons say they will do, named after the op at the cursor —
   * "Undo · Retry", "Redo · Your turn". Undo now walks back through edits,
   * deletions and take switches as well as generations, so a fixed label would
   * be a guess about which of those is next; the controller derives these from
   * the story's own history state instead.
   */
  undoLabel: string
  redoLabel: string
  /** Returns true when the text was accepted — the textarea clears on true. */
  onSend: (text: string, kind: "say" | "do") => boolean
  onContinue: () => void
  onRetry: () => void
  onUndo: () => void
  onRedo: () => void
  onStop: () => void
}) {
  const active = MODES.find((m) => m.value === mode) ?? MODES[0]
  const isImage = mode === "image"
  const markdownShortcuts = useMarkdownShortcuts()

  // Stoppable is not the same question as what the button shows. A run is
  // abortable from the instant it is dispatched — `pending` included, which is
  // what stopDuringStart in useGeneration exists to make good on — so Esc gets
  // the whole live window. `settling` is the exception at the far end: the
  // passage is already final and waiting on its row, and offering Stop there
  // would promise something that can no longer happen.
  const stoppable =
    status === "pending" || status === "thinking" || status === "streaming"

  // The button, though, holds a spinner across both of the windows where the
  // writer is waiting on the server rather than on the model: `pending`, before
  // the run is acknowledged, and `settling`, after the prose is final. Putting
  // Stop under the finger during `pending` is what made a send feel unsent —
  // the swap is an icon change under the thumb that just covered it, so the
  // natural second tap landed on Stop and killed the run they were waiting for.
  // A spinner is unmistakably "sent, working", and it is inert, so that second
  // tap costs nothing.
  const waiting = status === "pending" || status === "settling"
  const hasText = value.trim() !== ""

  // A keyboard swap moves nothing and speaks nothing: focus stays in the
  // textarea, so the changed aria-label and placeholder are never re-announced
  // and the meaning of the next keystroke has silently inverted. The status
  // region below fixes that — and stays empty until the first swap, because a
  // live region rendered with content already in it gets read out on page load.
  const [announceKind, setAnnounceKind] = React.useState(false)

  const swapKind = React.useCallback(() => {
    setAnnounceKind(true)
    // Tab swaps the two WRITING moves and never reaches Image. Tab is a
    // mid-sentence reflex, and a reflex that can land the writer in a different
    // medium — where the next keystrokes become an image prompt rather than
    // their turn — is a trap. Image is a deliberate choice: click it, or cycle
    // with Cmd/Ctrl+/.
    onModeChange(mode === "say" ? "do" : "say")
  }, [mode, onModeChange])

  // The move image mode was entered from, so leaving it is one tap rather than
  // a second decision. Image mode hides the segmented row (Do and Say do
  // nothing while a picture is being composed, and the two slots are exactly
  // what pushed the send button off a phone-width panel), so this is the only
  // record of where "back" goes. Session-local: a reload lands on Do, which is
  // the same default a fresh story gets.
  // State rather than a ref because the exit chip's label reads it while
  // rendering — the chip says where "back" goes. Adjusted during render rather
  // than in an effect for the same reason: an effect would paint one frame of
  // a chip pointing at the wrong move.
  const [lastWritingMode, setLastWritingMode] = React.useState<"do" | "say">(
    mode === "say" ? "say" : "do"
  )
  if (mode !== "image" && mode !== lastWritingMode) setLastWritingMode(mode)

  /** Cmd/Ctrl+/ reaches everything, Image included. */
  const cycleMode = React.useCallback(() => {
    setAnnounceKind(true)
    const index = MODES.findIndex((m) => m.value === mode)
    onModeChange(MODES[(index + 1) % MODES.length].value)
  }, [mode, onModeChange])

  // The question the lane on screen is an answer TO: the brief it was
  // developed from and the mutes it was developed under. Editing either past
  // that point makes the lane an answer to a question nobody is asking any
  // more, and the second ↵ has to re-develop rather than draw — silently
  // drawing the old prompt is the one outcome the writer cannot undo cheaply.
  // The mutes are half of that question: a chip tapped off after the develop
  // changes nothing about the lane's text, and drawing it anyway would ship
  // the muted entry under provenance that says it was left out.
  //
  // Seeded from the pair at mount (the editor is keyed per story, so mount IS
  // story open) because a persisted pair is taken as consistent: the writer
  // left them together, and greeting them with "stale" on every reload would
  // make the word meaningless.
  const [developedFor, setDevelopedFor] = React.useState<{
    brief: string
    muteKey: string
  } | null>(() =>
    imagePrompt !== null
      ? { brief: value.trim(), muteKey: loreMuteKey(excludedLoreIds) }
      : null
  )
  const [announceLane, setAnnounceLane] = React.useState(false)
  // Whether the folded rider chips are shown. Session-local and unremembered:
  // it is a look under the hood, not a preference.
  const [riderChipsOpen, setRiderChipsOpen] = React.useState(false)
  const riderCount = loreMatches.filter(
    (match) => match.triggeredBy?.kind !== "source"
  ).length
  const wasDeriving = React.useRef(deriving)
  React.useEffect(() => {
    // The stream finishing is the only moment the lane becomes authoritative.
    // Falling edge rather than a callback so a develop started on this device,
    // one started on another, and one that failed mid-stream all settle
    // through the same path. Dated by the run's own question, not this
    // device's: a device that attached to somebody else's develop may hold a
    // draft that has not caught up, and would mark the arriving lane stale
    // against a brief nobody asked.
    if (wasDeriving.current && !deriving) {
      setDevelopedFor({
        brief: derivedBrief ?? value.trim(),
        muteKey: loreMuteKey(derivedExcludedLoreIds ?? excludedLoreIds),
      })
      setAnnounceLane(true)
    }
    wasDeriving.current = deriving
  }, [deriving, derivedBrief, derivedExcludedLoreIds, excludedLoreIds, value])
  // The restore bridge (see the prop). Dated under the CURRENT mutes: the
  // restore does not touch them, and the pair being handed back is consistent
  // with whatever is muted right now by definition — it was drawn, not asked.
  const markDeveloped = React.useCallback(
    (developedForBrief: string | null) => {
      setDevelopedFor(
        developedForBrief === null
          ? null
          : { brief: developedForBrief, muteKey: loreMuteKey(excludedLoreIds) }
      )
    },
    [excludedLoreIds]
  )
  React.useEffect(() => {
    markDevelopedRef.current = markDeveloped
    return () => {
      markDevelopedRef.current = null
    }
  }, [markDevelopedRef, markDeveloped])

  const brief = value.trim()
  const lane = imagePrompt?.trim() ?? ""
  const laneStale =
    developedFor !== null &&
    (developedFor.brief !== brief ||
      developedFor.muteKey !== loreMuteKey(excludedLoreIds))
  const laneReady = imageAssisted && lane !== "" && !laneStale && !deriving
  // The lane is on screen from the instant a develop starts, so the first
  // streamed word arrives into a box that already exists rather than shoving
  // the toolbar down under the writer's thumb.
  const laneVisible = imageAssisted && (deriving || imagePrompt !== null)
  const laneAnnouncement = announceLane && laneReady

  /**
   * What the image mode's send slot does next.
   *
   * "develop" and "draw" are the two beats: the first ↵ buys the prompt, the
   * second spends it. Verbatim collapses them — with assistance off there is
   * nothing to buy.
   */
  const imageSendAction: "develop" | "draw" = !imageAssisted
    ? "draw"
    : laneReady
      ? "draw"
      : "develop"

  const dispatchImage = React.useCallback(() => {
    // No round-trip to check: an image is appended at the end of the
    // manuscript and cannot fail validation the way a turn can.
    onGenerateImage(
      imageAssisted
        ? {
            scene: lane,
            sourcePrompt: brief === "" ? null : brief,
            loreIds: includedLoreIds,
          }
        : // Verbatim records no brief and no lore: nothing was developed, so
          // there is no "what they asked for" distinct from what was sent.
          { scene: brief, sourcePrompt: null, loreIds: [] }
    )
    onValueChange("")
    onImagePromptChange(null)
    setDevelopedFor(null)
    setAnnounceLane(false)
  }, [
    brief,
    imageAssisted,
    includedLoreIds,
    lane,
    onGenerateImage,
    onImagePromptChange,
    onValueChange,
  ])

  const handleSend = React.useCallback(() => {
    if (busy) return
    if (isImage) {
      if (imageBusy || deriving) return
      if (imageSendAction === "draw") {
        if (imageAssisted ? lane === "" : brief === "") return
        dispatchImage()
        return
      }
      // Develop — but never from an empty brief. ↵ on an empty composer is a
      // stray keystroke far more often than a request to spend money, which is
      // the same reason Continue lives on ⌘↵. The wand is where the empty-brief
      // call (describe what is happening right now) is asked for out loud.
      if (brief === "") return
      onDevelop()
      return
    }
    if (!hasText) return
    if (onSend(value, mode)) onValueChange("")
  }, [
    brief,
    busy,
    deriving,
    dispatchImage,
    hasText,
    imageAssisted,
    imageBusy,
    imageSendAction,
    isImage,
    lane,
    mode,
    onDevelop,
    onSend,
    onValueChange,
    value,
  ])

  // Autofocus only where a hardware keyboard is likely: on touch devices it
  // would pop the software keyboard over the prose on every story open.
  React.useEffect(() => {
    if (window.matchMedia("(pointer: fine)").matches) {
      textareaRef.current?.focus()
    }
  }, [textareaRef])

  // Esc stops a generation from anywhere in the workspace — unless the reader
  // is typing in some other field (the passage editor uses Esc to cancel).
  React.useEffect(() => {
    if (!stoppable) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      const target = event.target
      if (
        target instanceof HTMLElement &&
        target !== textareaRef.current &&
        (target.isContentEditable ||
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement)
      ) {
        return
      }
      onStop()
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [stoppable, onStop, textareaRef])

  // The lane answers ↵ the same way the brief does, so a writer who tabbed in
  // to fix one word does not have to travel back up to send. Shift and Option
  // keep their newline; nothing else here is claimed, because this is a plain
  // field of machine text and the markdown shortcuts have no business in it.
  const onLaneKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter") return
    if (event.nativeEvent.isComposing) return
    if (event.shiftKey || event.altKey) return
    event.preventDefault()
    handleSend()
  }

  const onTextareaKeyDown = (
    event: React.KeyboardEvent<HTMLTextAreaElement>
  ) => {
    if (markdownShortcuts(event)) return

    if (event.key === "Enter") {
      // An IME is using Enter to commit a candidate, not to end the move.
      if (event.nativeEvent.isComposing) return

      if (event.metaKey || event.ctrlKey) {
        event.preventDefault()
        if (busy) return
        // In image mode handleSend decides for itself whether there is
        // anything to do — with a developed prompt waiting, an empty brief is
        // still a send.
        if (isImage) handleSend()
        else if (hasText) handleSend()
        else onContinue()
        return
      }

      // A move is a sentence, so Enter sends it and the newline moves to the
      // modifiers. Shift+Enter is already the textarea's own newline; Option
      // is not, and browsers do not agree on whether it inserts one, so it is
      // inserted here — through execCommand, which is the only way to keep the
      // native undo stack intact.
      if (event.altKey) {
        event.preventDefault()
        document.execCommand("insertText", false, "\n")
        return
      }
      if (event.shiftKey) return

      event.preventDefault()
      // Continue stays on Cmd/Ctrl+Enter: Enter on an empty composer is a
      // stray keystroke far more often than it is a request to generate. Image
      // mode guards itself instead — an empty brief under a developed prompt
      // is the wand's own path, and ↵ there draws what was already paid for.
      if (busy) return
      if (!isImage && !hasText) return
      handleSend()
      return
    }

    // Tab swaps Do/Say. Choosing the move is the most frequent thing a writer
    // does mid-sentence, so it gets the cheapest key — and the cost is real and
    // worth stating plainly: unmodified Tab is consumed unconditionally, so
    // there is no forward focus escape from the textarea to the toolbar beside
    // it. Shift+Tab is untouched, but the toolbar is *after* the textarea in
    // DOM order, so backward focus lands in the manuscript's last action
    // cluster, not on Send. A keyboard-only writer reaches the toolbar buttons
    // by Shift+Tab into the canvas or out through the browser chrome.
    // Cmd/Ctrl+/ is a second way to swap for anyone whose Tab is spoken for by
    // an OS or extension binding; it does not restore Tab, and nothing does.
    // Modified Tabs belong to the browser (window/tab switching), not to us.
    if (
      event.key === "Tab" &&
      !event.shiftKey &&
      !event.altKey &&
      !event.metaKey &&
      !event.ctrlKey
    ) {
      event.preventDefault()
      swapKind()
      return
    }
    if ((event.metaKey || event.ctrlKey) && event.key === "/") {
      event.preventDefault()
      cycleMode()
    }
  }

  return (
    <div
      ref={containerRef}
      className="pointer-events-none absolute inset-x-0 bottom-0 z-10"
    >
      <div className="mx-auto w-full max-w-2xl px-6 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="pointer-events-auto border bg-surface-glass shadow-lg backdrop-blur-md transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30">
          <Textarea
            ref={textareaRef}
            value={value}
            onChange={(event) => onValueChange(event.target.value)}
            onKeyDown={onTextareaKeyDown}
            // Locked while the develop call streams, like the lane below it:
            // the call is answering THIS brief, and an edit mid-stream would
            // land the answer already stale — the writer watches one thing
            // finish rather than racing it. readOnly, not disabled, so focus
            // and the caret survive the few seconds it takes.
            readOnly={isImage && deriving}
            placeholder={
              isImage && !imageAssisted
                ? VERBATIM_PLACEHOLDER
                : active.placeholder
            }
            // Reads "write your next move" rather than "write in first
            // person" because PR #22 believed the word "person" was what
            // summoned the contact bar. It was not — the form owner above is —
            // but the shorter phrasing is the better label anyway, so it
            // stays.
            aria-label={
              isImage
                ? imageAssisted
                  ? "Image — say what the picture is"
                  : "Image — describe the picture"
                : `${active.label} — write your next move`
            }
            // WebKit ignores `autocomplete="off"` for autofill, so this is
            // for the engines that honour it. The rest states outright that a
            // field of prose wants autocorrect and sentence case.
            autoComplete="off"
            autoCorrect="on"
            autoCapitalize="sentences"
            // Software keyboards label their return key from this, so the
            // touch case advertises what Enter now does instead of hiding it.
            enterKeyHint="send"
            spellCheck
            className="max-h-52 min-h-14 resize-none overflow-y-auto border-0 bg-transparent px-3 font-serif text-base leading-7 shadow-none focus-visible:ring-0"
          />
          {/* The lore the brief summoned, between the words that summoned it
              and the prompt it will shape. Nothing renders when nothing
              matched, so a resting composer is exactly as tall as it was.

              Split on WHO summoned it. An entry the brief named is the reason
              the chips exist and is always on screen; the riders — always-on
              entries and everything the cascade dragged in behind a name — can
              be dozens in a dense lorebook, and forty pills over a two-line
              brief buries the composer under its own provenance. They fold
              behind a count until asked for, and stay mutable once shown. */}
          {isImage && imageAssisted && loreMatches.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 px-3 pb-1">
              {(riderChipsOpen
                ? loreMatches
                : loreMatches.filter(
                    (match) => match.triggeredBy?.kind === "source"
                  )
              ).map((match) => {
                const muted = excludedLoreIds.has(match.entry.id)
                return (
                  <Tooltip key={match.entry.id}>
                    <TooltipTrigger
                      render={
                        <button
                          type="button"
                          // Included is the pressed state: the chip is the
                          // entry's presence in the call, and tapping it takes
                          // that away.
                          aria-pressed={!muted}
                          aria-label={`${match.entry.name} — ${
                            muted ? "left out of" : "included in"
                          } this prompt`}
                          // Locked with the rest of the image controls while a
                          // develop streams: a mute mid-run publishes a draft
                          // whose lane is still the pre-develop value, and that
                          // save would race the run's own write of the row.
                          disabled={deriving}
                          onClick={() => onToggleLore(match.entry.id)}
                          className={cn(
                            "disabled:pointer-events-none disabled:opacity-50",
                            // h-7 is the smallest comfortable thumb target that
                            // does not turn a row of names into a row of pills.
                            "inline-flex h-7 max-w-52 items-center truncate border px-2 text-[0.6875rem] tracking-wide uppercase transition-colors",
                            muted
                              ? "border-dashed border-border/60 text-muted-foreground/60 line-through"
                              : "border-border/60 text-muted-foreground hover:text-foreground"
                          )}
                        />
                      }
                    >
                      {match.entry.name}
                    </TooltipTrigger>
                    <TooltipContent>
                      {muted
                        ? `${match.entry.name} — left out; tap to put back`
                        : `${match.entry.name} — tap to leave out`}
                    </TooltipContent>
                  </Tooltip>
                )
              })}
              {riderCount > 0 && (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        aria-expanded={riderChipsOpen}
                        aria-label={
                          riderChipsOpen
                            ? "Hide the entries that ride along"
                            : `Show ${riderCount} more entries that ride along`
                        }
                        onClick={() => setRiderChipsOpen(!riderChipsOpen)}
                        className="inline-flex h-7 items-center px-2 text-[0.6875rem] tracking-wide text-muted-foreground/60 uppercase transition-colors hover:text-foreground"
                      />
                    }
                  >
                    {riderChipsOpen ? "less" : `+${riderCount}`}
                  </TooltipTrigger>
                  <TooltipContent>
                    {riderChipsOpen
                      ? "Hide the riders"
                      : `${riderCount} more ride along — always-on lore and the cascade`}
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          )}

          {/* The developed prompt. Mono and small because it is machine text
              addressed to a machine — the writer edits it, but it is not their
              prose, and setting it in the same serif as the brief above would
              claim otherwise. */}
          {isImage && laneVisible && (
            <div className="border-t border-border/60 px-3 pt-1.5 pb-1">
              <div className="flex items-baseline justify-between gap-2 pb-0.5">
                <span
                  id="developed-prompt-label"
                  className="text-[0.625rem] tracking-widest text-muted-foreground uppercase"
                >
                  {deriving
                    ? "Developing…"
                    : laneStale
                      ? "Brief changed — ↵ develops again"
                      : "Developed prompt — ↵ draws"}
                </span>
              </div>
              {/* A raw textarea rather than <Textarea>, because this is machine
                  text and wants none of that component's prose defaults — so
                  it needs its own form owner, for the reason documented
                  there. */}
              <form className="contents" onSubmit={(e) => e.preventDefault()}>
                <textarea
                  value={imagePrompt ?? ""}
                  onChange={(event) => onImagePromptChange(event.target.value)}
                  onKeyDown={onLaneKeyDown}
                  aria-labelledby="developed-prompt-label"
                  readOnly={deriving}
                  spellCheck={false}
                  enterKeyHint="send"
                  className="field-sizing-content max-h-40 w-full resize-none overflow-y-auto bg-transparent font-mono text-[0.76rem] leading-5 text-muted-foreground outline-none"
                />
              </form>
            </div>
          )}

          {/* What the next picture will be drawn WITH, as words rather than
              three unlabelled glyphs in the toolbar.

              Frame, style and assistance are all remembered per story and
              pressed rarely — they are state, not moves — while everything
              left in the row below is a move. Reading them as "16:9 ·
              Watercolour · Assisted" means the writer knows what the ↵ under
              their thumb is about to cost without hovering anything, which is
              what a row of three icons could never do; it also gives the
              toolbar back the width that was pushing Send off the panel on a
              phone. Same small caps as the lore chips above, so the panel
              gains no new kind of thing. */}
          {isImage && (
            <div className="flex flex-wrap items-center px-2 pb-1 text-[0.6875rem] tracking-wide uppercase">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      aria-label={`Frame: ${aspectRatio}`}
                      onClick={() =>
                        onAspectRatioChange(
                          IMAGE_ASPECT_RATIOS[
                            (IMAGE_ASPECT_RATIOS.indexOf(aspectRatio) + 1) %
                              IMAGE_ASPECT_RATIOS.length
                          ]
                        )
                      }
                      className={CAPTION_ITEM}
                    />
                  }
                >
                  <RectangleHorizontal
                    aria-hidden
                    className={cn("size-3", ASPECT_ICON_ROTATION[aspectRatio])}
                  />
                  {aspectRatio}
                </TooltipTrigger>
                <TooltipContent>
                  Frame {aspectRatio} — tap to cycle
                </TooltipContent>
              </Tooltip>

              <CaptionSeparator />

              <StyleButton
                style={imageStyle}
                onStyleChange={onImageStyleChange}
              />

              <CaptionSeparator />

              {/* Assistance, as a switch rather than a setting: it changes what
                  the very next ↵ costs. It reads as a word here for the same
                  reason — "Verbatim" says what will happen, where a pen nib
                  needed a tooltip to say it. */}
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      aria-label={
                        imageAssisted
                          ? "Assisted — the model expands your brief"
                          : "Verbatim — your words go as written"
                      }
                      aria-pressed={imageAssisted}
                      disabled={deriving || imageBusy}
                      onClick={() => onImageAssistedChange(!imageAssisted)}
                      className={cn(
                        CAPTION_ITEM,
                        imageAssisted && "text-foreground"
                      )}
                    />
                  }
                >
                  {imageAssisted ? (
                    <WandSparkles aria-hidden className="size-3" />
                  ) : (
                    <PenLine aria-hidden className="size-3" />
                  )}
                  {imageAssisted ? "Assisted" : "Verbatim"}
                </TooltipTrigger>
                <TooltipContent>
                  {imageAssisted
                    ? "Assisted — ↵ develops, then draws"
                    : "Verbatim — ↵ draws your words as written"}
                </TooltipContent>
              </Tooltip>
            </div>
          )}

          <span role="status" aria-live="polite" className="sr-only">
            {announceKind ? `${active.label} — ${active.placeholder}` : ""}
          </span>
          {/* Its own region: the develop call is the one thing here that starts
              and finishes without moving focus or changing what is on screen
              above it, so it is the one thing a screen reader would otherwise
              miss entirely. */}
          <span role="status" aria-live="polite" className="sr-only">
            {deriving
              ? "Developing the image prompt."
              : laneAnnouncement
                ? "Image prompt ready. Press Enter to draw."
                : ""}
          </span>
          {/* Scrolls rather than clips. The row is sized to fit its widest
              state on the narrowest phone, but it is a fixed-width row of
              fixed-width buttons, so the failure mode of adding one more
              control is Send silently leaving the panel — which is exactly
              what happened. A scroll container makes that degrade visibly
              instead. */}
          <div className="flex items-center gap-1 overflow-x-auto px-2 pb-2">
            {/* Do and Say are unreachable moves while a picture is being
                composed — Tab never reached Image and Image never reached
                back, so the two buttons were a pair of dead slots holding the
                width that pushed Send off the panel. In image mode they
                collapse into the mode itself, which now says its own name and
                offers the way out. Do/Say mode keeps the segmented row: there,
                which move is armed changes what every keystroke means, and
                that has to be readable without opening anything. */}
            {isImage ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="secondary"
                      size="sm"
                      className="gap-1.5 border-border px-2.5 text-foreground"
                      aria-label={`Image — leave for ${
                        lastWritingMode === "say" ? "Say" : "Do"
                      }`}
                      onClick={() => onModeChange(lastWritingMode)}
                    />
                  }
                >
                  <ImagePlus />
                  Image
                  <X aria-hidden className="size-3 opacity-60" />
                </TooltipTrigger>
                <TooltipContent>
                  Back to {lastWritingMode === "say" ? "Say" : "Do"}
                </TooltipContent>
              </Tooltip>
            ) : (
              <div className="flex items-center gap-0.5">
                {MODES.map((kind) => {
                  const selected = kind.value === active.value
                  return (
                    <Tooltip key={kind.value}>
                      <TooltipTrigger
                        render={
                          <Button
                            variant={selected ? "secondary" : "ghost"}
                            size="icon-sm"
                            // --secondary and --muted are the same value, so a
                            // secondary fill alone is exactly what ghost:hover
                            // looks like: hovering the unarmed move would make
                            // both buttons identical at the moment of choosing.
                            // The border and the full-contrast icon are the cues
                            // hover cannot imitate.
                            className={cn(
                              selected
                                ? "border-border text-foreground"
                                : "text-muted-foreground"
                            )}
                            aria-label={kind.label}
                            aria-pressed={selected}
                            onClick={() => onModeChange(kind.value)}
                          />
                        }
                      >
                        <kind.icon />
                      </TooltipTrigger>
                      {/* Tab takes you to the other WRITING move, so only an
                        unarmed Do/Say advertises it — Image is not on Tab. */}
                      <TooltipContent>
                        {selected || kind.value === "image"
                          ? kind.label
                          : `${kind.label} (Tab)`}
                      </TooltipContent>
                    </Tooltip>
                  )
                })}
              </div>
            )}

            <div className="flex-1" />

            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={undoLabel}
                    disabled={!canUndo}
                    onClick={onUndo}
                  />
                }
              >
                <Undo2 />
              </TooltipTrigger>
              <TooltipContent>{undoLabel}</TooltipContent>
            </Tooltip>

            {/* Redo sits beside Undo rather than being keyboard-only: the redo
                tail is invisible in the manuscript — an undone passage is gone
                from the prose — so a writer who has just undone one step has
                nothing on screen telling them it can be brought back. */}
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={redoLabel}
                    disabled={!canRedo}
                    onClick={onRedo}
                  />
                }
              >
                <Redo2 />
              </TooltipTrigger>
              <TooltipContent>{redoLabel}</TooltipContent>
            </Tooltip>

            {/* Retry and Continue are moves on PROSE — there is no "continue"
                for a picture, and retrying one is done on the picture itself.
                In image mode the pair collapses to one slot: the re-develop.
                Both rows are now the same width, and nothing inside image mode
                moves as the send slot cycles.

                The re-develop. With a brief it buys another expansion of it; with
                the brief empty it is the older gesture — describe whatever the
                story has just reached — which is the one place an empty
                composer may still spend money, because here the writer asked
                for it by name. */}
            {isImage ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={
                        brief === ""
                          ? "Write a prompt from the story"
                          : "Develop this brief again"
                      }
                      disabled={!imageAssisted || deriving || imageBusy}
                      onClick={onDevelop}
                    />
                  }
                >
                  <RotateCcw className={cn(deriving && "animate-pulse")} />
                </TooltipTrigger>
                {/* Says outright that this spends money. Nothing here
                      develops on its own precisely so the writer is the one who
                      decides to pay for it. */}
                <TooltipContent>
                  {brief === ""
                    ? "Write a prompt from the story · costs a call"
                    : "Develop again · costs a call"}
                </TooltipContent>
              </Tooltip>
            ) : (
              <>
                <RetryButton
                  icon={RotateCcw}
                  label="Retry last generation"
                  size="sm"
                  disabled={!canRetry}
                  onRetry={onRetry}
                  revealCaret
                />

                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="secondary"
                        size="icon-sm"
                        aria-label="Continue"
                        disabled={busy}
                        onClick={onContinue}
                      />
                    }
                  >
                    <FastForward />
                  </TooltipTrigger>
                  <TooltipContent>Continue (⌘↵)</TooltipContent>
                </Tooltip>
              </>
            )}

            {/* One slot, three states — Send, then a spinner, then Stop — all
                the same size and variant, so the sequence never shifts the row.
                No tooltip on the spinner: it is disabled, so it would never
                open one, and the canvas already announces the generation.
                Both waiting states are about a PROSE run; a picture reports
                its own progress in the placeholder it draws into. */}
            {isImage && deriving ? (
              <Button
                variant="default"
                size="icon-sm"
                aria-label="Developing"
                // Same reasoning as the prose spinner below: inert but at full
                // contrast, because this state is "it's working", not "you
                // can't". A develop is seconds, and Escape is not offered for
                // it — the writer's cheapest out is to let it land and edit.
                disabled
                className="disabled:opacity-100"
              >
                <Loader2 aria-hidden className="animate-spin" />
              </Button>
            ) : isImage ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="default"
                      size="icon-sm"
                      aria-label={
                        imageSendAction === "draw"
                          ? "Draw this image"
                          : "Develop the prompt"
                      }
                      disabled={
                        imageBusy ||
                        (imageSendAction === "draw"
                          ? imageAssisted
                            ? lane === ""
                            : brief === ""
                          : brief === "")
                      }
                      onClick={handleSend}
                    />
                  }
                >
                  {imageSendAction === "draw" ? <ArrowUp /> : <Sparkles />}
                </TooltipTrigger>
                <TooltipContent>
                  {imageSendAction === "draw"
                    ? "Draw (Enter)"
                    : "Develop the prompt (Enter) · costs a call"}
                </TooltipContent>
              </Tooltip>
            ) : waiting ? (
              <Button
                variant="default"
                size="icon-sm"
                aria-label="Sending"
                // Inert, but not dimmed like the other disabled states: this
                // one is not "you can't", it is "it's working", and the whole
                // job of the state is to be seen from across the room.
                disabled
                className="disabled:opacity-100"
              >
                <Loader2 aria-hidden className="animate-spin" />
              </Button>
            ) : stoppable ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="default"
                      size="icon-sm"
                      aria-label="Stop generating"
                      onClick={onStop}
                    />
                  }
                >
                  <Square className="fill-current" />
                </TooltipTrigger>
                <TooltipContent>Stop generating</TooltipContent>
              </Tooltip>
            ) : (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="default"
                      size="icon-sm"
                      aria-label="Send"
                      disabled={busy || !hasText}
                      onClick={handleSend}
                    />
                  }
                >
                  <ArrowUp />
                </TooltipTrigger>
                <TooltipContent>Send (Enter)</TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * The style control: eight offers and a free-text field.
 *
 * A popover rather than a row of choices, because style is chosen rarely and
 * then left alone for a whole story — it is remembered per story on the draft
 * row — while the composer's other controls are pressed several times a
 * paragraph. The trigger sits on the caption line and carries the state as a
 * word: the preset's name, "Custom" for a hand-written one, "No style" for
 * none — which is the whole reason the settings moved off the toolbar. A
 * filled palette icon could only ever say that something was set.
 *
 * Custom is a field rather than a thirteenth preset because the presets are a
 * starting point, not a taxonomy. Typing in it clears the preset selection by
 * construction: there is only ever one active string, and what the popover
 * shows is which preset — if any — that string came from.
 */
function StyleButton({
  style,
  onStyleChange,
}: {
  style: string | null
  onStyleChange: (style: string | null) => void
}) {
  const active = IMAGE_STYLE_PRESETS.find((preset) => preset.text === style)
  const label = active?.label ?? (style === null ? "No style" : "Custom")

  // Controlled so a preset can CLOSE it: picking from a short list is a
  // one-tap decision, and a popover that lingers afterwards demands a second
  // tap to dismiss what the first already settled. The Custom field is the
  // exception — typing is not a decision's end, so it leaves the popover be.
  const [open, setOpen] = React.useState(false)
  const pick = (next: string | null) => {
    onStyleChange(next)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <button
                  type="button"
                  aria-label={`Style: ${label}`}
                  className={cn(
                    CAPTION_ITEM,
                    style !== null && "text-foreground"
                  )}
                />
              }
            />
          }
        >
          <Palette aria-hidden className="size-3" />
          {label}
        </TooltipTrigger>
        <TooltipContent>Style — {label}</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" side="top" className="gap-2 p-2">
        <div className="flex flex-col">
          <button
            type="button"
            aria-pressed={style === null}
            onClick={() => pick(null)}
            className={cn(
              "flex h-8 items-center px-2 text-left text-xs transition-colors hover:bg-muted",
              style === null ? "text-foreground" : "text-muted-foreground"
            )}
          >
            No style
          </button>
          {IMAGE_STYLE_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              aria-pressed={preset.text === style}
              onClick={() => pick(preset.text)}
              className={cn(
                "flex h-8 items-center px-2 text-left text-xs transition-colors hover:bg-muted",
                preset.text === style
                  ? "text-foreground"
                  : "text-muted-foreground"
              )}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <Input
          value={active ? "" : (style ?? "")}
          onChange={(event) =>
            onStyleChange(event.target.value === "" ? null : event.target.value)
          }
          placeholder="Custom…"
          aria-label="Custom style"
          className="h-8 px-2 text-xs"
        />
      </PopoverContent>
    </Popover>
  )
}
