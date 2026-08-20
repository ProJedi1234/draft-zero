"use client"

import * as React from "react"

import { LoreSection } from "@/components/inspector/sections/lore-section"
import { ModelSection } from "@/components/inspector/sections/model-section"
import { PromptSection } from "@/components/inspector/sections/prompt-section"
import { StatusStrip } from "@/components/inspector/status-strip"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { useModelSettings } from "@/hooks/use-model-settings"
import type {
  LorebookEntry,
  ModelProfile,
  OpenRouterModel,
  Story,
} from "@/lib/types"
import { cn } from "@/lib/utils"

export function InspectorPanel({
  story,
  lorebookEntries,
  models,
  profiles,
  defaultProfileId,
  className,
}: {
  story: Story
  lorebookEntries: LorebookEntry[]
  models: OpenRouterModel[]
  /** Every profile, in the writer's order — the switcher's list. */
  profiles: ModelProfile[]
  /** The profile new stories start from; starred in the switcher. */
  defaultProfileId: string | null
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
        profiles={profiles}
        defaultProfileId={defaultProfileId}
      />
    </aside>
  )
}

/**
 * Inspector sections without the aside chrome — shared by the desktop panel and
 * the mobile sheet. The `key` remounts everything when the writer switches
 * stories, which is what clears any edit-in-flight bookkeeping the old story's
 * controls were holding; while mounted, every control follows the server on its
 * own (see hooks/use-server-synced.ts).
 */
export function InspectorContent({
  story,
  lorebookEntries,
  models,
  profiles,
  defaultProfileId,
}: {
  story: Story
  lorebookEntries: LorebookEntry[]
  models: OpenRouterModel[]
  profiles: ModelProfile[]
  defaultProfileId: string | null
}) {
  return (
    <InspectorSections
      key={story.id}
      story={story}
      lorebookEntries={lorebookEntries}
      models={models}
      profiles={profiles}
      defaultProfileId={defaultProfileId}
    />
  )
}

/**
 * The panel's three sections over a pinned status strip.
 *
 * The model state is held here rather than inside <ModelSection> because the
 * strip reads it too — it prints the live model identity and the context window,
 * and both have to be the controls' values rather than the story's. See
 * hooks/use-model-settings.ts. The prompt and lore sections need nothing from
 * out here and own their state themselves.
 */
function InspectorSections({
  story,
  lorebookEntries,
  models,
  profiles,
  defaultProfileId,
}: {
  story: Story
  lorebookEntries: LorebookEntry[]
  models: OpenRouterModel[]
  profiles: ModelProfile[]
  defaultProfileId: string | null
}) {
  const settings = useModelSettings({ story, models, profiles })

  return (
    <>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-6 px-4 py-4">
          <ModelSection
            story={story}
            models={models}
            profiles={profiles}
            defaultProfileId={defaultProfileId}
            settings={settings}
          />

          <Separator />

          <PromptSection story={story} />

          <Separator />

          <LoreSection story={story} lorebookEntries={lorebookEntries} />
        </div>
      </ScrollArea>
      <StatusStrip
        story={story}
        lorebookEntries={lorebookEntries}
        contextWindow={settings.contextWindow}
        models={models}
        identity={{
          modelId: settings.modelId,
          providerTag: settings.providerTag,
          thinking: settings.thinking,
        }}
      />
    </>
  )
}
