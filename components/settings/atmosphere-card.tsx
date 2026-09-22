"use client"

import * as React from "react"
import { toast } from "sonner"

import { ModelPicker } from "@/components/inspector/model-picker"
import { SliderField } from "@/components/slider-field"
import { levelForModel } from "@/components/thinking-select"
import { ZdrSwitch, type ZdrLock } from "@/components/zdr-switch"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useAccountZdrForModel } from "@/hooks/use-account-zdr"
import { useModelEndpoints } from "@/hooks/use-model-endpoints"
import { useServerSyncedValue } from "@/hooks/use-server-synced"
import { updateAppSettings } from "@/lib/actions/settings"
import { ATMOSPHERE_DECISION_MODEL_ID } from "@/lib/generation/atmosphere-decision"
import { DEFAULT_ATMOSPHERE_MODEL_ID } from "@/lib/generation/atmosphere-prompt"
import type {
  AtmosphereEngine,
  AtmosphereSettings,
  OpenRouterModel,
} from "@/lib/types"

const FALLBACK_ERROR = "Couldn't save the atmosphere model."

/**
 * What chooses a story's tint, for the stories that let it.
 *
 * Two engines, and the tabs are not decoration. A language model is told the
 * question in prose and answers in prose, so it needs a model, a temperature
 * and an output cap; a decision model is handed typed questions and answers
 * with probabilities, and accepts none of the three. Four of the six controls
 * here are meaningless under the second engine, which is why the body swaps
 * rather than the model picker gaining an entry — and why the decision model
 * is NOT in that picker, since choosing it there would send a story's
 * generation down a route that has no messages array to put it in.
 *
 * The LANGUAGE model's settings survive a visit to the other tab, because they
 * are their own columns rather than one polymorphic bundle. A writer who tuned
 * a model, a temperature and a cap still has all three when they come back.
 *
 * Two controls sit outside the tabs because they are properties of the job
 * rather than of the engine. How often to check is about cost and cadence, and
 * a story's prose goes on the wire either way.
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
  // write. No version, because this row has no updatedAt and the bundle's own
  // JSON sorts "decision" before "llm" — one engine tab switch would latch the
  // card off the server for the life of the mount.
  const synced = useServerSyncedValue(atmosphere)
  const draft = synced.value
  const [, startTransition] = React.useTransition()

  // Resolved for display only; the row stores NULL until the picker is opened.
  const modelId = draft.modelId ?? DEFAULT_ATMOSPHERE_MODEL_ID
  const { endpoints } = useModelEndpoints(modelId)
  // Asked per model because OpenRouter's retention policy is five per-group
  // toggles, not one — so the two engines can genuinely differ, and both
  // questions are asked unconditionally rather than behind the active tab.
  const accountZdr = useAccountZdrForModel(modelId)
  const decisionAccountZdr = useAccountZdrForModel(ATMOSPHERE_DECISION_MODEL_ID)
  const zdrLock: ZdrLock =
    accountZdr === "enforced" ? "account" : requireZdr ? "app" : null
  const decisionZdrLock: ZdrLock =
    decisionAccountZdr === "enforced" ? "account" : requireZdr ? "app" : null
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

  function handleEngineChange(next: AtmosphereEngine) {
    if (next === draft.engine) return
    // Only the discriminant moves. Everything the other engine needs is
    // already in the row and is deliberately left where it is — switching
    // back must return the writer to what they had, not to the defaults.
    save({ ...draft, engine: next })
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
        <Tabs
          value={draft.engine}
          onValueChange={(next) => handleEngineChange(next as AtmosphereEngine)}
        >
          <TabsList className="h-9 w-full">
            <TabsTrigger value="llm" className="flex-1 text-xs">
              Language model
            </TabsTrigger>
            <TabsTrigger value="decision" className="flex-1 text-xs">
              Decision model
            </TabsTrigger>
          </TabsList>

          <TabsContent value="llm" className="mt-4">
            <ModelPicker
              models={models}
              value={modelId}
              onValueChange={handleModelChange}
              endpoints={endpoints}
              providerTag={draft.providerTag}
              onProviderTagChange={(providerTag) =>
                save({ ...draft, providerTag })
              }
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
                onValueCommitted={(next) =>
                  save({ ...draft, temperature: next })
                }
                hint="Low is right for this: there are eight answers and a shrug, and warmth only makes the shrug rarer."
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
          </TabsContent>

          <TabsContent value="decision" className="mt-4">
            <p className="text-sm text-muted-foreground">
              Answers with a probability instead of a sentence, in about a tenth
              of the time and for a fraction of the price. It is asked two
              questions at once — whether the tint still fits, and which one
              fits best — and there is nothing to sample, so there is no model,
              temperature or output cap to set.
            </p>
            <p className="mt-3 text-sm text-muted-foreground">
              Worth measuring rather than assuming. Reading a mood is softer
              than the work these models are strongest at, so try it on a story
              you know and keep whichever reads better.
            </p>
            <div className="mt-6">
              <SliderField
                label="Confidence to repaint"
                value={draft.minConfidence}
                min={0.5}
                max={0.95}
                step={0.01}
                onValueChange={(next) =>
                  synced.setLocal({ ...draft, minConfidence: next })
                }
                onValueCommitted={(next) =>
                  save({ ...draft, minConfidence: next })
                }
                formatReadout={(value) => `${Math.round(value * 100)}%`}
                hint="How sure it has to be before it changes a colour you are already reading in. Higher holds steadier through a passing dark scene; lower follows the story more closely. A story with no colour yet is always given one."
              />
            </div>
            <div className="mt-6">
              <ZdrSwitch
                id="atmosphere-decision-zdr"
                checked={zdr}
                onCheckedChange={(next) => save({ ...draft, zdr: next })}
                lock={decisionZdrLock}
                hint="The manuscript tail goes on the wire either way, so this is the same promise the language model makes."
              />
            </div>
          </TabsContent>
        </Tabs>

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
      </CardContent>
    </Card>
  )
}
