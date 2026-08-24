"use client"

import * as React from "react"

import { LoreSection } from "@/components/inspector/sections/lore-section"
import { ModelSection } from "@/components/inspector/sections/model-section"
import { PromptSection } from "@/components/inspector/sections/prompt-section"
import { StatusStrip } from "@/components/inspector/status-strip"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useAccountZdrForModel } from "@/hooks/use-account-zdr"
import { useModelSettings } from "@/hooks/use-model-settings"
import type {
  LorebookEntry,
  ModelProfile,
  OpenRouterModel,
  Story,
} from "@/lib/types"
import { cn } from "@/lib/utils"

/**
 * The three questions the panel answers, in the order a writer asks them:
 * what the model reads, what runs it, and what got pulled in.
 *
 * They are also the rule for where a new control goes. The panel spent nine
 * days growing by appending because it had no such rule, and the last feature
 * to arrive left one of its own settings unbuilt for want of a home.
 */
export type InspectorTab = "prompt" | "model" | "lore"

export function InspectorPanel({
  story,
  lorebookEntries,
  models,
  profiles,
  defaultProfileId,
  requireZdr,
  tab,
  onTabChange,
  collapsed,
}: {
  story: Story
  lorebookEntries: LorebookEntry[]
  models: OpenRouterModel[]
  /** Every profile, in the writer's order — the switcher's list. */
  profiles: ModelProfile[]
  /** The profile new stories start from; starred in the switcher. */
  defaultProfileId: string | null
  /** The app-wide retention policy; the model section's switch sits on it. */
  requireZdr: boolean
  /** Owned by the workspace: a writer preference, not a property of the story. */
  tab: InspectorTab
  onTabChange: (tab: InspectorTab) => void
  /** Hidden by a width collapse, on the sidebar's timing. */
  collapsed: boolean
}) {
  return (
    <aside
      aria-label="Inspector"
      // A clipped panel is still laid out, so without this its comboboxes stay
      // in the tab order and Tab from the composer lands inside nothing.
      inert={collapsed}
      className={cn(
        "hidden w-80 shrink-0 flex-col overflow-hidden border-l bg-background transition-[width,opacity] duration-200 ease-linear lg:flex",
        // The reduced-motion block in globals.css is scoped to the run mark;
        // nothing there covers a transition added later.
        "motion-reduce:transition-none",
        collapsed && "w-0 opacity-0"
      )}
    >
      {/* The shell is what narrows; the sections keep their full width and slide
          out behind its clip. Reflowing three segments and a status strip down
          to nothing over 200ms is the ugly version of this animation. */}
      <div className="flex h-full w-80 min-w-80 flex-col">
        <InspectorContent
          story={story}
          lorebookEntries={lorebookEntries}
          models={models}
          profiles={profiles}
          defaultProfileId={defaultProfileId}
          requireZdr={requireZdr}
          tab={tab}
          onTabChange={onTabChange}
        />
      </div>
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
  requireZdr,
  tab,
  onTabChange,
}: {
  story: Story
  lorebookEntries: LorebookEntry[]
  models: OpenRouterModel[]
  profiles: ModelProfile[]
  defaultProfileId: string | null
  requireZdr: boolean
  tab: InspectorTab
  onTabChange: (tab: InspectorTab) => void
}) {
  return (
    <InspectorSections
      key={story.id}
      story={story}
      lorebookEntries={lorebookEntries}
      models={models}
      profiles={profiles}
      defaultProfileId={defaultProfileId}
      requireZdr={requireZdr}
      tab={tab}
      onTabChange={onTabChange}
    />
  )
}

/**
 * Three segments over a pinned status strip.
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
  requireZdr,
  tab,
  onTabChange,
}: {
  story: Story
  lorebookEntries: LorebookEntry[]
  models: OpenRouterModel[]
  profiles: ModelProfile[]
  defaultProfileId: string | null
  requireZdr: boolean
  tab: InspectorTab
  onTabChange: (tab: InspectorTab) => void
}) {
  const settings = useModelSettings({ story, models, profiles })
  // Asked once here because two things read it: the model section, whose switch
  // it locks, and the strip below, whose shield has to show the policy the next
  // request will actually go out under.
  const accountZdr = useAccountZdrForModel(settings.modelId)
  const accountEnforced = accountZdr === "enforced"
  // Computed by the read layer with the same matcher the cards use
  // (lib/db/mappers.ts), so the badge and the list can never disagree.
  const activeLoreCount = story.activeLorebookEntryIds.length

  return (
    <>
      <Tabs
        value={tab}
        onValueChange={(next) => onTabChange(next as InspectorTab)}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <div className="shrink-0 px-3 pt-3">
          <TabsList className="h-9 w-full">
            <TabsTrigger value="prompt" className="px-2 text-[0.6875rem]">
              Prompt
            </TabsTrigger>
            <TabsTrigger
              value="model"
              className="gap-1.5 px-2 text-[0.6875rem]"
            >
              Model
              {/* Off-profile is the one thing about this tab worth knowing
                  without opening it: a Custom story's settings are its own and
                  drift from every profile silently. */}
              {settings.isCustom ? (
                <>
                  {/* aria-label on a bare span reaches almost no screen reader;
                      the dot is decorative and the words are the real label. */}
                  <span
                    aria-hidden
                    className="size-1.5 rounded-full bg-foreground/50"
                  />
                  <span className="sr-only">, custom settings</span>
                </>
              ) : null}
            </TabsTrigger>
            <TabsTrigger value="lore" className="gap-1.5 px-2 text-[0.6875rem]">
              Lore
              {activeLoreCount > 0 ? (
                <>
                  <span
                    aria-hidden
                    className="rounded-full bg-foreground/10 px-1.5 text-[0.625rem] leading-4 tabular-nums"
                  >
                    {activeLoreCount}
                  </span>
                  <span className="sr-only">
                    , {activeLoreCount}{" "}
                    {activeLoreCount === 1 ? "entry" : "entries"} in context
                  </span>
                </>
              ) : null}
            </TabsTrigger>
          </TabsList>
        </div>

        {/* keepMounted, and a ScrollArea per panel: switching segments must not
            unmount a field mid-edit — useAutosave would flush on the way out
            and the uncontrolled textarea would remount from props — and each
            section keeps its own scroll offset this way. */}
        <TabsContent value="prompt" keepMounted className="min-h-0 flex-1">
          <ScrollArea className="h-full">
            <div className="px-4 py-4">
              <PromptSection story={story} />
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="model" keepMounted className="min-h-0 flex-1">
          <ScrollArea className="h-full">
            <div className="px-4 py-4">
              <ModelSection
                story={story}
                models={models}
                profiles={profiles}
                defaultProfileId={defaultProfileId}
                requireZdr={requireZdr}
                accountEnforced={accountEnforced}
                settings={settings}
              />
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="lore" keepMounted className="min-h-0 flex-1">
          <ScrollArea className="h-full">
            <div className="px-4 py-4">
              <LoreSection story={story} lorebookEntries={lorebookEntries} />
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>

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
        zdr={settings.zdr || accountEnforced}
        onModelClick={() => onTabChange("model")}
      />
    </>
  )
}
