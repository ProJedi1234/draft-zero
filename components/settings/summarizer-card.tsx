"use client"

import * as React from "react"
import { toast } from "sonner"

import { ChevronDown } from "lucide-react"

import { ModelPicker } from "@/components/inspector/model-picker"
import { SliderField } from "@/components/slider-field"
import { levelForModel } from "@/components/thinking-select"
import type { ZdrLock } from "@/components/zdr-switch"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { useAccountZdrForModel } from "@/hooks/use-account-zdr"
import { useServerSyncedValue } from "@/hooks/use-server-synced"
import { useModelEndpoints } from "@/hooks/use-model-endpoints"
import { updateAppSettings } from "@/lib/actions/settings"
import { DEFAULT_SUMMARIZER_MODEL_ID } from "@/lib/generation/summary-prompt"
import { summaryWordTarget } from "@/lib/generation/summary-plan"
import type { OpenRouterModel, SummarizerSettings } from "@/lib/types"

const FALLBACK_ERROR = "Couldn't save the summarizer."

/**
 * What writes the rolling story summaries.
 *
 * The same picker a story and a profile use, and for the same reasons: the
 * choice of provider matters here at least as much as it does for prose. This
 * model runs every few passages for as long as a story keeps growing, so the
 * price and the tokens-per-second in that menu are the numbers the choice
 * actually turns on — and a third-party host serving a shorter window is a real
 * failure mode for a job whose whole input is a batch of prose.
 *
 * App-wide rather than per story: compressing prose without losing names is one
 * job with one right answer, and it is emphatically not the model the writer
 * picked to write their book. A story on a frontier model would otherwise pay
 * frontier prices for bookkeeping without ever being asked.
 *
 * Length and sampling sit under Advanced, closed by default, because the two
 * that matter have good derived defaults: the target scales with the story's
 * window, and the cap leaves slack over the target. Both say "auto" until they
 * are moved, and revert to it.
 *
 * The frequency and presence penalties are the one thing deliberately NOT
 * offered. Every other sampling value here is a preference; those two are a
 * correctness hazard for this particular job — a recap has to repeat the names,
 * places and debts that matter, which is exactly what they punish.
 */
export function SummarizerCard({
  models,
  summarizer,
  requireZdr,
  defaultContextWindow,
}: {
  models: OpenRouterModel[]
  summarizer: SummarizerSettings
  /** The app-wide retention floor, which this bundle can add to but not escape. */
  requireZdr: boolean
  /** The window a new story starts with — what "auto" resolves to, shown as the hint. */
  defaultContextWindow: number
}) {
  // Follows the server while mounted — this bundle is app-wide, so another
  // device changing it has to land here — but never over the top of a write
  // this device still has travelling. The picker is several controls that each
  // write on change and their writes overlap, which is exactly the case the
  // version argument exists for. See hooks/use-server-synced.ts.
  const synced = useServerSyncedValue(summarizer, {
    version: JSON.stringify(summarizer),
  })
  const draft = synced.value
  const [, startTransition] = React.useTransition()

  // Resolved for display only. The row stores NULL until the picker is opened,
  // which is what lets an untouched install follow the built-in default as it
  // changes; the moment a choice is made it becomes concrete.
  const modelId = draft.modelId ?? DEFAULT_SUMMARIZER_MODEL_ID
  const { endpoints } = useModelEndpoints(modelId)
  const accountZdr = useAccountZdrForModel(modelId)
  const zdrLock: ZdrLock =
    accountZdr === "enforced" ? "account" : requireZdr ? "app" : null
  const zdr = draft.zdr || requireZdr

  // What "auto" currently resolves to, so a slider sitting on its derived value
  // shows that value rather than a blank or a zero.
  const autoTarget = summaryWordTarget(defaultContextWindow)
  const autoCap = Math.round((draft.targetWords ?? autoTarget) * 3)

  /** Drag frames: move the thumb without claiming anything was saved. */
  function setLocal(next: SummarizerSettings) {
    synced.setLocal(next)
  }

  function save(next: SummarizerSettings) {
    const previous = draft
    synced.write(next)
    startTransition(async () => {
      let ok = false
      let message = FALLBACK_ERROR
      try {
        const result = await updateAppSettings({ summarizer: next })
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
    // The same coupling the inspector and the profile editor enforce: a
    // provider tag names an endpoint of the OLD model, and a thinking level the
    // new model does not offer would be rejected on send.
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
        <CardTitle>Summarizer</CardTitle>
        <CardDescription>
          Once a story outgrows its context window, this writes the recap that
          stands in for the part that no longer fits. It runs every few
          passages, so cheap and fast beats clever here.
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

        <Collapsible>
          <CollapsibleTrigger
            render={
              <Button
                variant="ghost"
                size="xs"
                className="mt-4 w-full justify-between text-muted-foreground"
              >
                Length and sampling
                <ChevronDown className="size-3 transition-transform group-data-panel-open:rotate-180" />
              </Button>
            }
          />
          <CollapsibleContent className="space-y-6 pt-4">
            <SliderField
              label="Summary length"
              value={draft.targetWords ?? autoTarget}
              min={25}
              max={2000}
              step={25}
              inherited={draft.targetWords === null}
              onRevert={
                draft.targetWords === null
                  ? undefined
                  : () => save({ ...draft, targetWords: null, maxTokens: null })
              }
              onValueChange={(next) =>
                setLocal({ ...draft, targetWords: next })
              }
              onValueCommitted={(next) => save({ ...draft, targetWords: next })}
              formatReadout={(value) => `${value} words`}
              hint={
                draft.targetWords === null
                  ? `Scales with each story's context window — ${autoTarget} words at the default.`
                  : "The same length whatever the story's window."
              }
            />
            <SliderField
              label="Output cap"
              value={draft.maxTokens ?? autoCap}
              min={64}
              max={8192}
              step={64}
              inherited={draft.maxTokens === null}
              onRevert={
                draft.maxTokens === null
                  ? undefined
                  : () => save({ ...draft, maxTokens: null })
              }
              onValueChange={(next) => setLocal({ ...draft, maxTokens: next })}
              onValueCommitted={(next) => save({ ...draft, maxTokens: next })}
              formatReadout={(value) => `${value} tokens`}
              hint="Where the provider stops. Leave it well above the length above — a recap that runs long gets compressed on the next pass, but one cut off mid-sentence is kept as it is."
            />
            <SliderField
              label="Temperature"
              value={draft.temperature}
              min={0}
              max={2}
              step={0.01}
              onValueChange={(next) =>
                setLocal({ ...draft, temperature: next })
              }
              onValueCommitted={(next) => save({ ...draft, temperature: next })}
              hint="Low is right for this: it is compression, not invention."
            />
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  )
}
