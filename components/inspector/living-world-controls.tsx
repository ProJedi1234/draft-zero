"use client"

import * as React from "react"
import { toast } from "sonner"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { useServerSyncedValue } from "@/hooks/use-server-synced"
import { WorldProseField } from "./world-prose-field"
import { updateStoryMeta } from "@/lib/actions/stories"
import { PACING_MAX_CHARS } from "@/lib/services/world.schema"
import type { Story } from "@/lib/types"
import { WorldSection } from "./sections/world-section"

export function LivingWorldControls({ story }: { story: Story }) {
  const uid = React.useId()
  const enabled = useServerSyncedValue(
    story.features?.world?.enabled ?? false,
    {
      version: story.updatedAt,
    }
  )
  const pacingRef = React.useRef<HTMLTextAreaElement>(null)
  const [pending, startTransition] = React.useTransition()
  const [pacingSaving, setPacingSaving] = React.useState(false)
  const cancelPacing = React.useRef<(() => void) | null>(null)

  function toggle(next: boolean) {
    cancelPacing.current?.()
    const previous = enabled.value
    const text = pacingRef.current?.value ?? story.features?.world?.pacing ?? ""
    enabled.write(next)
    startTransition(async () => {
      try {
        const result = await updateStoryMeta(story.id, {
          features: {
            ...story.features,
            world: { enabled: next, pacing: text },
          },
        })
        if (result.ok) enabled.settle()
        else {
          enabled.reset(previous)
          toast.error(result.error)
        }
      } catch {
        enabled.reset(previous)
        toast.error("Couldn't save your changes.")
      }
    })
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-4">
        <Label htmlFor={`${uid}-world`}>Living world</Label>
        <Switch
          id={`${uid}-world`}
          checked={enabled.value}
          onCheckedChange={toggle}
          disabled={pending || pacingSaving}
        />
      </div>
      {enabled.value && (
        <>
          <WorldProseField
            title="Pacing rules"
            value={story.features?.world?.pacing ?? ""}
            placeholder="How time passes in this story…"
            maxLength={PACING_MAX_CHARS}
            inputRef={pacingRef}
            cancelRef={cancelPacing}
            onSavingChange={setPacingSaving}
            disabled={pending}
            save={(pacing) =>
              updateStoryMeta(story.id, {
                features: {
                  ...story.features,
                  world: { enabled: enabled.value, pacing },
                },
              })
            }
          />
        </>
      )}
      <div hidden={!enabled.value}>
        <WorldSection storyId={story.id} enabled={enabled.value} />
      </div>
    </div>
  )
}
