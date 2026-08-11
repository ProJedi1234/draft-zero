"use client"

import { CircleCheck, PanelRight } from "lucide-react"

import type { Story } from "@/lib/types"
import { formatWordCount } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

export function StoryHeader({
  story,
  inspectorOpen,
  onToggleInspector,
  onOpenMobileInspector,
}: {
  story: Story
  inspectorOpen: boolean
  onToggleInspector: () => void
  onOpenMobileInspector: () => void
}) {
  const inspectorLabel = inspectorOpen ? "Hide inspector" : "Show inspector"

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
      <SidebarTrigger />
      <Separator orientation="vertical" className="h-4" />
      <h1 className="truncate text-sm font-medium">{story.title}</h1>
      <span className="hidden text-xs text-muted-foreground sm:inline">
        {formatWordCount(story.wordCount)}
      </span>
      <div className="flex-1" />
      <span className="hidden items-center gap-1.5 text-xs text-muted-foreground md:flex">
        <CircleCheck className="size-3.5" />
        Saved locally
      </span>
      {/* Below lg the inspector lives in a sheet; at lg+ it's a toggleable side panel. */}
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Open inspector"
              onClick={onOpenMobileInspector}
              className="lg:hidden"
            />
          }
        >
          <PanelRight className="size-4" />
        </TooltipTrigger>
        <TooltipContent>Open inspector</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={inspectorLabel}
              aria-pressed={inspectorOpen}
              onClick={onToggleInspector}
              className="hidden lg:inline-flex"
            />
          }
        >
          <PanelRight className="size-4" />
        </TooltipTrigger>
        <TooltipContent>{inspectorLabel}</TooltipContent>
      </Tooltip>
    </header>
  )
}
