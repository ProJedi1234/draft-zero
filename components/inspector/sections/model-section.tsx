"use client"

import { ChevronsUpDown } from "lucide-react"

import { ContextWindowSlider } from "@/components/inspector/context-window-slider"
import { ModelPicker, ProfileCard } from "@/components/inspector/model-picker"
import { SaveProfileDialog } from "@/components/inspector/save-profile-dialog"
import { SettingSlider } from "@/components/inspector/setting-slider"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import type { ModelSettings } from "@/hooks/use-model-settings"
import type { ModelProfile, OpenRouterModel, Story } from "@/lib/types"

/**
 * What runs the story: the profile it follows, or — in Custom mode — the model,
 * the endpoint serving it, how hard it thinks, and the six sliders.
 *
 * Presentational. Every value and every write comes from useModelSettings,
 * which the panel owns because the status strip reads from it too.
 */
export function ModelSection({
  story,
  models,
  profiles,
  defaultProfileId,
  settings,
}: {
  story: Story
  models: OpenRouterModel[]
  profiles: ModelProfile[]
  defaultProfileId: string | null
  settings: ModelSettings
}) {
  // Bound out so the ternary below narrows it — reaching through `settings`
  // inside the branch would need a non-null assertion to say the same thing.
  const { basedOnProfile } = settings

  return (
    <div className="space-y-3">
      <ProfileCard
        profiles={profiles}
        profileId={settings.profileId}
        defaultProfileId={defaultProfileId}
        onProfileChange={settings.handleProfileChange}
        switching={settings.profileSwitching}
        models={models}
        endpoints={settings.endpoints}
        basedOnName={basedOnProfile?.name ?? null}
        onOpenChange={settings.setProfileMenuOpen}
      />

      {/* Following a profile there is nothing here to tune: the bundle is
          global, and a knob in the story would be a silent fork of it. */}
      {settings.isCustom ? (
        <div className="space-y-1">
          <ModelPicker
            models={models}
            value={settings.modelId}
            onValueChange={settings.handleModelChange}
            endpoints={settings.endpoints}
            providerTag={settings.providerTag}
            onProviderTagChange={settings.handleProviderChange}
            thinking={settings.thinking}
            onThinkingChange={settings.handleThinkingChange}
            onOpenChange={settings.setPickerOpen}
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
                version={story.updatedAt}
                field="temperature"
                label="Temperature"
                serverValue={story.settings.temperature}
                min={0}
                max={2}
                step={0.01}
              />
              <SettingSlider
                storyId={story.id}
                version={story.updatedAt}
                field="topP"
                label="Top P"
                serverValue={story.settings.topP}
                min={0}
                max={1}
                step={0.01}
              />
              <SettingSlider
                storyId={story.id}
                version={story.updatedAt}
                field="maxTokens"
                label="Max tokens"
                serverValue={story.settings.maxTokens}
                min={128}
                max={4096}
                step={128}
              />
              <ContextWindowSlider
                value={settings.contextWindow}
                contextLength={settings.contextLength}
                dragProps={settings.windowDragProps}
                onValueChange={settings.setContextWindowLocal}
                onValueCommitted={(next) => {
                  // A release that settled back on the stored stop is not a
                  // change; anything else is, including a return to a stop
                  // the model clamp moved us off earlier.
                  const previous = settings.savedContextWindow
                  settings.writeContextWindow(next)
                  if (next === previous) return
                  settings.saveSettings({ contextWindow: next }, (ok) => {
                    if (ok) settings.settleContextWindow()
                    else settings.resetContextWindow(previous)
                  })
                }}
              />
              <SettingSlider
                storyId={story.id}
                version={story.updatedAt}
                field="frequencyPenalty"
                label="Frequency penalty"
                serverValue={story.settings.frequencyPenalty}
                min={-2}
                max={2}
                step={0.1}
              />
              <SettingSlider
                storyId={story.id}
                version={story.updatedAt}
                field="presencePenalty"
                label="Presence penalty"
                serverValue={story.settings.presencePenalty}
                min={-2}
                max={2}
                step={0.1}
              />
            </CollapsibleContent>
          </Collapsible>

          <div className="flex items-center justify-between gap-2 pt-1">
            <Button
              variant="ghost"
              size="xs"
              className="text-muted-foreground"
              onClick={() => settings.setSaveProfileOpen(true)}
            >
              Save as profile…
            </Button>
            {basedOnProfile ? (
              <Button
                variant="ghost"
                size="xs"
                className="min-w-0 text-muted-foreground"
                onClick={() => settings.handleProfileChange(basedOnProfile.id)}
              >
                <span className="truncate">Back to {basedOnProfile.name}</span>
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      <SaveProfileDialog
        storyId={story.id}
        open={settings.saveProfileOpen}
        onOpenChange={settings.setSaveProfileOpen}
        // The action already pointed the story at the new profile, so this only
        // catches the switcher up; the fresh props are on their way in the same
        // transition.
        onSaved={settings.adoptSavedProfile}
      />
    </div>
  )
}
