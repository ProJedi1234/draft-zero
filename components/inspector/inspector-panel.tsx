"use client"

import { ChevronsUpDown } from "lucide-react"

import { LoreTab } from "@/components/inspector/lore-tab"
import { ModelPicker } from "@/components/inspector/model-picker"
import { SettingSlider } from "@/components/inspector/setting-slider"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { MOCK_MODELS } from "@/lib/mock-data"
import type { Story } from "@/lib/types"
import { cn } from "@/lib/utils"

export function InspectorPanel({
  story,
  className,
}: {
  story: Story
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
      <InspectorContent story={story} />
    </aside>
  )
}

/** Inspector sections without the aside chrome — shared by the desktop panel and the mobile sheet. */
export function InspectorContent({ story }: { story: Story }) {
  return (
    <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-6 p-4">
          <div className="space-y-1">
            <ModelPicker
              models={MOCK_MODELS}
              defaultModelId={story.settings.modelId}
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
                  label="Temperature"
                  defaultValue={story.settings.temperature}
                  min={0}
                  max={2}
                  step={0.01}
                />
                <SettingSlider
                  label="Top P"
                  defaultValue={story.settings.topP}
                  min={0}
                  max={1}
                  step={0.01}
                />
                <SettingSlider
                  label="Max tokens"
                  defaultValue={story.settings.maxTokens}
                  min={128}
                  max={4096}
                  step={128}
                />
                <SettingSlider
                  label="Frequency penalty"
                  defaultValue={story.settings.frequencyPenalty}
                  min={-2}
                  max={2}
                  step={0.1}
                />
                <SettingSlider
                  label="Presence penalty"
                  defaultValue={story.settings.presencePenalty}
                  min={-2}
                  max={2}
                  step={0.1}
                />
              </CollapsibleContent>
            </Collapsible>
          </div>

          <Separator />

          <div className="space-y-2">
            <Label htmlFor="inspector-memory">Memory</Label>
            <Textarea
              id="inspector-memory"
              defaultValue={story.memory}
              className="min-h-24"
              placeholder="Facts the model should always remember…"
            />
            <p className="text-xs text-muted-foreground">
              Always included at the top of context.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="inspector-authors-note">Author&apos;s note</Label>
            <Textarea
              id="inspector-authors-note"
              defaultValue={story.authorsNote}
              className="min-h-16"
              placeholder="Steer tone and style…"
            />
            <p className="text-xs text-muted-foreground">
              Injected near the most recent words.
            </p>
          </div>

          <Separator />

          <div className="space-y-3">
            <Label>Lorebook</Label>
            <LoreTab story={story} />
          </div>
        </div>
      </ScrollArea>
  )
}
