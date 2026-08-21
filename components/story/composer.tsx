"use client"

import * as React from "react"
import {
  ArrowUp,
  FastForward,
  Loader2,
  MessageSquareQuote,
  Redo2,
  RotateCcw,
  Square,
  Swords,
  Undo2,
} from "lucide-react"

import type { ActionKind } from "@/lib/types"
import type { GenerationStatus } from "@/hooks/use-generation"
import { cn } from "@/lib/utils"
import { useMarkdownShortcuts } from "@/hooks/use-markdown-shortcuts"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { RetryButton } from "@/components/story/retry-profile-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

/**
 * The writer has exactly two moves. They are a segmented pair rather than a
 * dropdown because which one is armed changes what every keystroke means, and
 * that has to be readable without opening anything.
 */
const KINDS = [
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
] as const

export function Composer({
  value,
  onValueChange,
  actionKind,
  onActionKindChange,
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
  /** Owned by the workspace so switching stories doesn't reset it. */
  actionKind: ActionKind
  onActionKindChange: (kind: ActionKind) => void
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
  onSend: (text: string, kind: ActionKind) => boolean
  onContinue: () => void
  onRetry: () => void
  onUndo: () => void
  onRedo: () => void
  onStop: () => void
}) {
  const active = KINDS.find((k) => k.value === actionKind) ?? KINDS[0]
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
    onActionKindChange(actionKind === "do" ? "say" : "do")
  }, [actionKind, onActionKindChange])

  const handleSend = React.useCallback(() => {
    if (busy || !hasText) return
    if (onSend(value, actionKind)) onValueChange("")
  }, [actionKind, busy, hasText, onSend, onValueChange, value])

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
        if (hasText) handleSend()
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
      // stray keystroke far more often than it is a request to generate.
      if (busy || !hasText) return
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
      swapKind()
    }
  }

  return (
    <div
      ref={containerRef}
      className="pointer-events-none absolute inset-x-0 bottom-0 z-10"
    >
      <div className="mx-auto w-full max-w-2xl px-6 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="pointer-events-auto border bg-background/65 shadow-lg backdrop-blur-md transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30">
          <Textarea
            ref={textareaRef}
            value={value}
            onChange={(event) => onValueChange(event.target.value)}
            onKeyDown={onTextareaKeyDown}
            placeholder={active.placeholder}
            // Deliberately avoids the word "person". Safari classifies fields
            // by regexing their accessible name for tokens like name/person,
            // and with no `name` or `id` on this textarea the aria-label is the
            // only string it has — "write in first person" made it a contact
            // field, which is what summoned the AutoFill Contact bar and turned
            // autocorrect off. The guidance is worth keeping; it just cannot be
            // phrased that way here.
            aria-label={`${active.label} — write your next move`}
            // Belt and braces, not the fix — the aria-label above is what
            // actually stopped Safari classifying this as a name field, and
            // `autocomplete="off"` alone did nothing there, because WebKit
            // ignores it for autofill. These stay for the engines that do honour
            // it, and to state outright that a field of prose wants autocorrect
            // and sentence case rather than leaving it to be inferred again.
            autoComplete="off"
            autoCorrect="on"
            autoCapitalize="sentences"
            // Software keyboards label their return key from this, so the
            // touch case advertises what Enter now does instead of hiding it.
            enterKeyHint="send"
            spellCheck
            className="max-h-52 min-h-14 resize-none overflow-y-auto border-0 bg-transparent px-3 font-serif text-base leading-7 shadow-none focus-visible:ring-0"
          />
          <span role="status" aria-live="polite" className="sr-only">
            {announceKind ? `${active.label} — ${active.placeholder}` : ""}
          </span>
          <div className="flex items-center gap-1 px-2 pb-2">
            <div className="flex items-center gap-0.5">
              {KINDS.map((kind) => {
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
                          onClick={() => onActionKindChange(kind.value)}
                        />
                      }
                    >
                      <kind.icon />
                    </TooltipTrigger>
                    {/* Tab is what takes you to the *other* move, so only the
                        unarmed one advertises it. */}
                    <TooltipContent>
                      {selected ? kind.label : `${kind.label} (Tab)`}
                    </TooltipContent>
                  </Tooltip>
                )
              })}
            </div>

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

            {/* One slot, three states — Send, then a spinner, then Stop — all
                the same size and variant, so the sequence never shifts the row.
                No tooltip on the spinner: it is disabled, so it would never
                open one, and the canvas already announces the generation. */}
            {waiting ? (
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
