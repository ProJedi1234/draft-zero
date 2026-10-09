"use client"

import * as React from "react"
import { TriangleAlert } from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { DEFAULT_ATMOSPHERE_MODEL_ID } from "@/lib/generation/atmosphere-prompt"
import { DEFAULT_SUMMARIZER_MODEL_ID } from "@/lib/generation/summary-prompt"
import {
  isLocalModelId,
  type AtmosphereSettings,
  type LocalModelsStatus,
  type OpenRouterModel,
  type SummarizerSettings,
} from "@/lib/types"
import { cn } from "@/lib/utils"

function subscribeMinutes(onChange: () => void) {
  const timer = setInterval(onChange, 60_000)
  return () => clearInterval(timer)
}

/**
 * The wall clock to the minute, or null on the server and the first client
 * paint, so the countdown never hydrates over a server-rendered number.
 */
function useMinuteClock(): number | null {
  const minute = React.useSyncExternalStore(
    subscribeMinutes,
    () => Math.floor(Date.now() / 60_000),
    () => null
  )
  return minute === null ? null : minute * 60_000
}

/** "unloads in 4 min", or null once the time has passed or is unknown. */
function unloadsIn(
  expiresAt: string | null,
  now: number | null
): string | null {
  if (!expiresAt || now === null) return null
  const minutes = Math.round((Date.parse(expiresAt) - now) / 60_000)
  if (!Number.isFinite(minutes) || minutes < 0) return null
  return minutes < 1 ? "unloads in under a minute" : `unloads in ${minutes} min`
}

/**
 * The local Ollama host: whether it is answering, what it has, and the one
 * setting that decides how often it has to re-read a story. Read-only, because
 * the host and its window are deploy configuration (OLLAMA_BASE_URL and
 * OLLAMA_NUM_CTX) rather than something a writer tunes.
 */
export function LocalModelsCard({
  status,
  models,
  summarizer,
  atmosphere,
}: {
  status: LocalModelsStatus
  models: OpenRouterModel[]
  summarizer: SummarizerSettings
  atmosphere: AtmosphereSettings
}) {
  const now = useMinuteClock()
  // Background jobs on a local model share its single slot with the story, so
  // each one evicts the story's cached prompt.
  const background = [
    {
      job: "summarizer",
      modelId: summarizer.modelId ?? DEFAULT_SUMMARIZER_MODEL_ID,
    },
    ...(atmosphere.engine === "llm"
      ? [
          {
            job: "atmosphere check",
            modelId: atmosphere.modelId ?? DEFAULT_ATMOSPHERE_MODEL_ID,
          },
        ]
      : []),
  ].filter(({ modelId }) => isLocalModelId(modelId))
  const nameOf = (modelId: string) =>
    models.find((m) => m.id === modelId)?.name ?? modelId

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Local models</CardTitle>
        <CardDescription>
          Models served by Ollama on your own hardware. They cost nothing, and
          the prose never leaves your network.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="flex items-center gap-2 bg-muted/60 px-3 py-2 text-xs">
          <span
            aria-hidden
            className={cn(
              "size-2 shrink-0 rounded-full",
              status.reachable ? "bg-emerald-500" : "bg-destructive"
            )}
          />
          {status.reachable ? (
            <span>
              <span className="font-medium">{status.host}</span> is answering ·
              Ollama {status.version} · {status.chatModels} chat{" "}
              {status.chatModels === 1 ? "model" : "models"} ·{" "}
              {status.decisionModels} decision{" "}
              {status.decisionModels === 1 ? "model" : "models"}
            </span>
          ) : (
            <span>
              <span className="font-medium">{status.host}</span> isn&apos;t
              answering. Local models are hidden until it is.
            </span>
          )}
        </div>

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
          <dt className="text-muted-foreground">Endpoint</dt>
          <dd className="truncate font-mono">{status.baseUrl}</dd>
          <dt className="text-muted-foreground">In memory</dt>
          <dd>
            {status.loaded.length === 0
              ? "Nothing loaded"
              : status.loaded
                  .map((m) =>
                    [m.name, unloadsIn(m.expiresAt, now)]
                      .filter(Boolean)
                      .join(", ")
                  )
                  .join(" · ")}
          </dd>
          <dt className="text-muted-foreground">Context window</dt>
          <dd className="tabular-nums">
            {status.contextWindow.toLocaleString("en-US")} tokens
          </dd>
        </dl>
        <p className="text-xs text-muted-foreground">
          Sent with every local request, and set on the server with
          OLLAMA_NUM_CTX. A request asking for a different window reloads the
          model, and a cold model takes over a minute to read a long story.
        </p>

        {background.length > 0 ? (
          <div className="flex gap-2 bg-amber-100 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
            <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
            <span>
              Your {background.map((b) => b.job).join(" and ")}{" "}
              {background.length === 1 ? "runs" : "run"} on{" "}
              {[...new Set(background.map((b) => nameOf(b.modelId)))].join(
                " and "
              )}
              . {status.host} answers one request at a time, so each of these
              pushes a story out of the model&apos;s cache and the next passage
              re-reads it from the start.
            </span>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
