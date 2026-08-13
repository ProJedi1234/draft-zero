"use client"

import * as React from "react"
import {
  ArrowUp,
  FastForward,
  MessageSquareQuote,
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
  canRetry,
  onSend,
  onContinue,
  onRetry,
  onUndo,
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
  canRetry: boolean
  /** Returns true when the text was accepted — the textarea clears on true. */
  onSend: (text: string, kind: ActionKind) => boolean
  onContinue: () => void
  onRetry: () => void
  onUndo: () => void
  onStop: () => void
}) {
  const active = KINDS.find((k) => k.value === actionKind) ?? KINDS[0]
  const markdownShortcuts = useMarkdownShortcuts()

  // Not `status !== "idle"`: `settling` is busy but not stoppable — the passage
  // is already final and waiting on its row, so offering Stop there would
  // promise something that can no longer happen. The Send button comes back
  // (disabled, via `busy`) for that sliver instead of a dead Stop.
  // `thinking` very much is stoppable, and is the state a writer is most likely
  // to want out of — it is the long one.
  const generating =
    status === "pending" || status === "thinking" || status === "streaming"
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
    if (!generating) return

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
  }, [generating, onStop, textareaRef])

  const onTextareaKeyDown = (
    event: React.KeyboardEvent<HTMLTextAreaElement>
  ) => {
    if (markdownShortcuts(event)) return
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault()
      if (busy) return
      if (hasText) handleSend()
      else onContinue()
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
                    aria-label="Undo last passage"
                    disabled={!canUndo}
                    onClick={onUndo}
                  />
                }
              >
                <Undo2 />
              </TooltipTrigger>
              <TooltipContent>Undo last passage</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Retry last generation"
                    disabled={!canRetry}
                    onClick={onRetry}
                  />
                }
              >
                <RotateCcw />
              </TooltipTrigger>
              <TooltipContent>Retry last generation</TooltipContent>
            </Tooltip>

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
              <TooltipContent>Continue</TooltipContent>
            </Tooltip>

            {/* The Send slot becomes Stop while a generation is in flight —
                same size, same variant, no layout shift. */}
            {generating ? (
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
                <TooltipContent>Send</TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
