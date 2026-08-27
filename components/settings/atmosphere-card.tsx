"use client"

import * as React from "react"
import { toast } from "sonner"

import { ModelPicker } from "@/components/inspector/model-picker"
import { SliderField } from "@/components/slider-field"
import { levelForModel } from "@/components/thinking-select"
import type { ZdrLock } from "@/components/zdr-switch"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { useAccountZdrForModel } from "@/hooks/use-account-zdr"
import { useModelEndpoints } from "@/hooks/use-model-endpoints"
import { useServerSyncedValue } from "@/hooks/use-server-synced"
import { updateAppSettings } from "@/lib/actions/settings"
import { DEFAULT_ATMOSPHERE_MODEL_ID } from "@/lib/generation/atmosphere-prompt"
import type { AtmosphereSettings, OpenRouterModel } from "@/lib/types"

const FALLBACK_ERROR = "Couldn't save the atmosphere model."

/**
 * What chooses a story's tint, for the stories that let it.
 *
 * The summarizer's card without its target-length control: the answer is one
 * word from a closed list, so there is no length to aim for. Temperature
 * stays, and stays low — this is a reading of a scene, not a contribution to
 * it.
 *
 * The cap DOES stay, and it is the least decorative control on this card. A
 * model that reasons spends the cap thinking before it answers, and a cap it
 * cannot finish inside returns nothing at all, which reaches the writer as a
 * picker that has quietly stopped working. The writer chooses the model, so
 * the writer needs the number that makes their model usable.
 *
 * App-wide for the same reason the summarizer is: naming the mood of a passage
 * is one job with one right answer, and it runs after turns for as long as a
 * story keeps growing. The per-story question — whether this may touch THIS
 * story at all — is a switch in the inspector, where the colour is.
 */
export function AtmosphereCard({
  models,
  atmosphere,
  requireZdr,
}: {
  models: OpenRouterModel[]
  atmosphere: AtmosphereSettings
  /** The app-wide retention floor, which this bundle can add to but not escape. */
  requireZdr: boolean
}) {
  // Follows the server while mounted but never over the top of an in-flight
  // write — the picker is several controls whose writes overlap. Versioned on
  // the bundle itself because this row has no updatedAt of its own.
  const synced = useServerSyncedValue(atmosphere, {
    version: JSON.stringify(atmosphere),
  })
  const draft = synced.value
  const [, startTransition] = React.useTransition()

  // Resolved for display only; the row stores NULL until the picker is opened.
  const modelId = draft.modelId ?? DEFAULT_ATMOSPHERE_MODEL_ID
  const { endpoints } = useModelEndpoints(modelId)
  const accountZdr = useAccountZdrForModel(modelId)
  const zdrLock: ZdrLock =
    accountZdr === "enforced" ? "account" : requireZdr ? "app" : null
  const zdr = draft.zdr || requireZdr

  function save(next: AtmosphereSettings) {
    const previous = draft
    synced.write(next)
    startTransition(async () => {
      let ok = false
      let message = FALLBACK_ERROR
      try {
        const result = await updateAppSettings({ atmosphere: next })
        ok = result.ok
        if (!result.ok) message = result.error
      } catch (error) {
        message =
          error instanceof Error && error.message ? error.message : message
      }
      if (ok) {
        synced.settle()
      } else {
        synced.reset(previous)
        toast.error(message)
      }
    })
  }

  function handleModelChange(nextModelId: string) {
    if (nextModelId === modelId) return
    const nextModel = models.find((model) => model.id === nextModelId)
    // The same coupling every other picker enforces: a provider tag names an
    // endpoint of the OLD model, and a thinking level the new one does not
    // offer would be rejected on send.
    save({
      ...draft,
      modelId: nextModelId,
      providerTag: null,
      thinking: levelForModel(nextModel?.reasoning, draft.thinking),
    })
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Atmosphere</CardTitle>
        <CardDescription>
          After a turn, this reads the last of the manuscript and picks the
          colour the story is read in — or says the scene has not moved, which
          is most of the time. Stories with a tint set by hand are left alone.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ModelPicker
          models={models}
          value={modelId}
          onValueChange={handleModelChange}
          endpoints={endpoints}
          providerTag={draft.providerTag}
          onProviderTagChange={(providerTag) => save({ ...draft, providerTag })}
          thinking={draft.thinking}
          onThinkingChange={(thinking) => save({ ...draft, thinking })}
          zdr={zdr}
          onZdrChange={(next) => save({ ...draft, zdr: next })}
          zdrLock={zdrLock}
          accountEnforced={accountZdr === "enforced"}
        />
        <div className="mt-6">
          <SliderField
            label="Temperature"
            value={draft.temperature}
            min={0}
            max={2}
            step={0.01}
            onValueChange={(next) =>
              synced.setLocal({ ...draft, temperature: next })
            }
            onValueCommitted={(next) => save({ ...draft, temperature: next })}
            hint="Low is right for this: there are eight answers and a shrug, and warmth only makes the shrug rarer."
          />
        </div>
        <div className="mt-6">
          <SliderField
            label="Passages between checks"
            value={draft.passagesBetweenChecks}
            min={1}
            max={20}
            step={1}
            onValueChange={(next) =>
              synced.setLocal({ ...draft, passagesBetweenChecks: next })
            }
            onValueCommitted={(next) =>
              save({ ...draft, passagesBetweenChecks: next })
            }
            formatReadout={(value) =>
              value === 1 ? "every passage" : `every ${value}`
            }
            hint="How much has to happen before it looks again. A story of short exchanges moves slower than this number suggests; one of long passages, faster."
          />
        </div>
        <div className="mt-6">
          <SliderField
            label="Max tokens"
            value={draft.maxTokens}
            min={64}
            max={8192}
            step={64}
            onValueChange={(next) =>
              synced.setLocal({ ...draft, maxTokens: next })
            }
            onValueCommitted={(next) => save({ ...draft, maxTokens: next })}
            hint="A ceiling, not a spend: the answer is one word, and the rest is room for a model that thinks first. Raise it if this model keeps answering nothing."
          />
        </div>
      </CardContent>
    </Card>
  )
}
