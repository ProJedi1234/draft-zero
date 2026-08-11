"use client"

import * as React from "react"
import {
  ArrowUp,
  FastForward,
  Feather,
  MessageSquareText,
  RotateCcw,
  Square,
  Undo2,
} from "lucide-react"

import type { ComposerMode, GenerationStatus } from "@/hooks/use-generation"
import { useMarkdownShortcuts } from "@/hooks/use-markdown-shortcuts"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Textarea } from "@/components/ui/textarea"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

const MODES = [
  {
    value: "story",
    label: "Story",
    icon: Feather,
    placeholder: "Write what happens next…",
  },
  {
    value: "instruction",
    label: "Instruction",
    icon: MessageSquareText,
    placeholder: "Tell the model what to do next…",
  },
] as const

export function Composer({
  value,
  onValueChange,
  mode: modeValue,
  onModeChange,
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
  mode: ComposerMode
  onModeChange: (mode: ComposerMode) => void
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  /** The floating panel, measured by the workspace to reserve canvas padding. */
  containerRef?: React.RefObject<HTMLDivElement | null>
  status: GenerationStatus
  busy: boolean
  canUndo: boolean
  canRetry: boolean
  /** Returns true when the text was accepted — the textarea clears on true. */
  onSend: (text: string, mode: ComposerMode) => boolean
  onContinue: () => void
  onRetry: () => void
  onUndo: () => void
  onStop: () => void
}) {
  const mode = MODES.find((m) => m.value === modeValue) ?? MODES[0]
  const markdownShortcuts = useMarkdownShortcuts()

  const generating = status !== "idle"
  const hasText = value.trim() !== ""
  const ModeIcon = mode.icon

  const handleSend = React.useCallback(() => {
    if (busy || !hasText) return
    if (onSend(value, mode.value)) onValueChange("")
  }, [busy, hasText, mode.value, onSend, onValueChange, value])

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
            placeholder={mode.placeholder}
            aria-label="Story input"
            className="max-h-52 min-h-14 resize-none overflow-y-auto border-0 bg-transparent px-3 font-serif text-base leading-7 shadow-none focus-visible:ring-0"
          />
          <div className="flex items-center gap-1 px-2 pb-2">
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <DropdownMenuTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Input mode: ${mode.label}`}
                        />
                      }
                    />
                  }
                >
                  <ModeIcon />
                </TooltipTrigger>
                <TooltipContent>{mode.label} mode</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="start">
                {MODES.map((m) => (
                  <DropdownMenuItem
                    key={m.value}
                    onClick={() => onModeChange(m.value)}
                  >
                    <m.icon />
                    {m.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

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
