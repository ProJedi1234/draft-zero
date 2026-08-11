"use client"

import { useState } from "react"

import type { Story } from "@/lib/types"
import { cn } from "@/lib/utils"
import {
  InspectorContent,
  InspectorPanel,
} from "@/components/inspector/inspector-panel"
import { Composer } from "@/components/story/composer"
import { StoryCanvas } from "@/components/story/story-canvas"
import { StoryHeader } from "@/components/story/story-header"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"

export function StoryWorkspace({ story }: { story: Story }) {
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const [mobileInspectorOpen, setMobileInspectorOpen] = useState(false)

  return (
    <div className="flex h-svh min-w-0 flex-col">
      <StoryHeader
        story={story}
        inspectorOpen={inspectorOpen}
        onToggleInspector={() => setInspectorOpen((o) => !o)}
        onOpenMobileInspector={() => setMobileInspectorOpen(true)}
      />
      <div className="flex min-h-0 flex-1">
        <div className="relative flex min-w-0 flex-1 flex-col">
          <StoryCanvas story={story} />
          <Composer />
        </div>
        <InspectorPanel
          story={story}
          className={cn("hidden", inspectorOpen && "lg:flex")}
        />
      </div>

      <Sheet open={mobileInspectorOpen} onOpenChange={setMobileInspectorOpen}>
        <SheetContent side="right" className="w-80 gap-0 lg:hidden">
          <SheetHeader className="border-b p-4">
            <SheetTitle className="text-sm">Inspector</SheetTitle>
          </SheetHeader>
          <InspectorContent story={story} />
        </SheetContent>
      </Sheet>
    </div>
  )
}
