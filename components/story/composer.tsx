"use client"

import { useState } from "react"
import {
  ArrowUp,
  FastForward,
  Feather,
  MessageSquareText,
  RotateCcw,
  Undo2,
} from "lucide-react"

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
  { value: "story", label: "Story", icon: Feather },
  { value: "instruction", label: "Instruction", icon: MessageSquareText },
] as const

type Mode = (typeof MODES)[number]

const ACTIONS = [
  { icon: Undo2, label: "Undo last passage", variant: "ghost" },
  { icon: RotateCcw, label: "Retry last generation", variant: "ghost" },
  { icon: FastForward, label: "Continue", variant: "secondary" },
  { icon: ArrowUp, label: "Send", variant: "default" },
] as const

export function Composer() {
  const [mode, setMode] = useState<Mode>(MODES[0])
  const ModeIcon = mode.icon

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10">
      <div className="mx-auto w-full max-w-2xl px-6 pb-5">
        <div className="pointer-events-auto border bg-background/65 shadow-lg backdrop-blur-md transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30">
          <Textarea
            placeholder="Write what happens next…"
            aria-label="Story input"
            className="min-h-14 resize-none border-0 bg-transparent px-3 font-serif text-base leading-7 shadow-none focus-visible:ring-0"
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
                  <DropdownMenuItem key={m.value} onClick={() => setMode(m)}>
                    <m.icon />
                    {m.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <div className="flex-1" />

            {ACTIONS.map(({ icon: Icon, label, variant }) => (
              <Tooltip key={label}>
                <TooltipTrigger
                  render={
                    <Button variant={variant} size="icon-sm" aria-label={label} />
                  }
                >
                  <Icon />
                </TooltipTrigger>
                <TooltipContent>{label}</TooltipContent>
              </Tooltip>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
