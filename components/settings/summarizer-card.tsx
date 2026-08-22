"use client"

import * as React from "react"
import { toast } from "sonner"

import { ModelPicker } from "@/components/inspector/model-picker"
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
import { useServerSyncedValue } from "@/hooks/use-server-synced"
import { useModelEndpoints } from "@/hooks/use-model-endpoints"
import { updateAppSettings } from "@/lib/actions/settings"
import { DEFAULT_SUMMARIZER_MODEL_ID } from "@/lib/generation/summary-prompt"
import type { OpenRouterModel, SummarizerIdentity } from "@/lib/types"

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
 * Sampling is deliberately absent. Temperature and the two penalties are
 * properties of the JOB rather than of the model — a summary has to repeat the
 * names and debts that matter, so the penalties stay pinned at zero wherever
 * this points — which is also why this is not a model_profiles row: there are
 * no sliders here worth inheriting.
 */
export function SummarizerCard({
  models,
  summarizer,
  requireZdr,
}: {
  models: OpenRouterModel[]
  summarizer: SummarizerIdentity
  /** The app-wide retention floor, which this bundle can add to but not escape. */
  requireZdr: boolean
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

  function save(next: SummarizerIdentity) {
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
      </CardContent>
    </Card>
  )
}
