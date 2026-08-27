"use client"

import * as React from "react"
import { toast } from "sonner"

import { ImageModelSelect } from "@/components/inspector/image-model-select"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useServerSyncedValue } from "@/hooks/use-server-synced"
import { updateAppSettings } from "@/lib/actions/settings"
import {
  IMAGE_CONTEXT_OPTIONS,
  type OpenRouterImageModel,
} from "@/lib/types"

/** "1k" reads at a glance where "1,024 tokens" has to be parsed. */
function contextLabel(tokens: number): string {
  return `${tokens / 1024}k tokens`
}

/**
 * The image side of the app's defaults: what stories draw with unless they
 * chose their own, and how much story the wand reads when writing a prompt.
 *
 * App-wide rather than per profile, deliberately — images sit outside model
 * profiles, so this card is the only place their defaults live. That makes the
 * default model the writer's one lever over every story that never chose,
 * which is why it gets a real picker rather than being left to the catalog's
 * sort order — "whatever OpenRouter lists first" is an accident, not a choice.
 */
export function ImageGenerationCard({
  imageModels,
  defaultImageModelId,
  imageContextTokens,
  defaultPrice,
  requireZdr,
}: {
  imageModels: OpenRouterImageModel[]
  /** The stored default, or null for the catalog's first eligible entry. */
  defaultImageModelId: string | null
  imageContextTokens: number
  /** What the resolved default costs per image, or null when unknown. */
  defaultPrice: string | null
  /** The app-wide retention floor — the picker greys what it rules out. */
  requireZdr: boolean
}) {
  const [, startTransition] = React.useTransition()
  const model = useServerSyncedValue(defaultImageModelId)
  const context = useServerSyncedValue(imageContextTokens)

  function saveModel(next: string | null) {
    const previous = model.value
    model.write(next)
    startTransition(async () => {
      const res = await updateAppSettings({
        defaultImageModelId: next,
      }).catch(() => ({ ok: false as const, error: "Couldn't save." }))
      if (res.ok) model.settle()
      else {
        model.reset(previous)
        toast.error(res.error)
      }
    })
  }

  function saveContext(next: number) {
    const previous = context.value
    context.write(next)
    startTransition(async () => {
      const res = await updateAppSettings({
        imageContextTokens: next,
      }).catch(() => ({ ok: false as const, error: "Couldn't save." }))
      if (res.ok) context.settle()
      else {
        context.reset(previous)
        toast.error(res.error)
      }
    })
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Images</CardTitle>
        <CardDescription>
          What stories illustrate with unless they choose their own model, and
          how much of the story the wand reads when writing a prompt.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <ImageModelSelect
          label="Default image model"
          models={imageModels}
          value={model.value}
          price={defaultPrice}
          zdr={requireZdr}
          onValueChange={saveModel}
        />
        <div className="space-y-2">
          <Label htmlFor="image-context">Prompt context</Label>
          <Select
            value={String(context.value)}
            onValueChange={(next) => saveContext(Number(next))}
          >
            <SelectTrigger id="image-context" className="w-full">
              {/* base-ui's Value renders the raw value string; the label is
                  ours to say. */}
              <SelectValue>{contextLabel(context.value)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {IMAGE_CONTEXT_OPTIONS.map((tokens) => (
                <SelectItem key={tokens} value={String(tokens)}>
                  {contextLabel(tokens)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* The trade in one line, because a bare token count answers nothing:
              the number buys recency, while the summary and lore carry the
              long-range facts at every size. */}
          <p className="text-xs text-muted-foreground">
            Recent story sent when deriving a prompt. Memory, lore and the
            summary always ride along; more mostly buys longer scenes, not
            better ones.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
