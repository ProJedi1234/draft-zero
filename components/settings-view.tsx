"use client"

import * as React from "react"
import Link from "next/link"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

import { ModelCombobox } from "@/components/model-combobox"
import { levelForModel, ThinkingSelect } from "@/components/thinking-select"
import { ThemeToggle } from "@/components/theme-toggle"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { updateAppSettings, verifyOpenRouterKey } from "@/lib/actions/settings"
import type { AppSettings, OpenRouterModel, ThinkingLevel } from "@/lib/types"

function SettingsView({
  settings,
  models,
}: {
  settings: AppSettings
  models: OpenRouterModel[]
}) {
  const [verifying, setVerifying] = React.useState(false)
  const [modelId, setModelId] = React.useState(settings.defaultModelId)
  const [thinking, setThinking] = React.useState(settings.defaultThinking)
  const [isPending, startTransition] = React.useTransition()

  function handleModelChange(next: string) {
    if (next === "" || next === modelId) return
    const previous = { modelId, thinking }
    // Same rule as the inspector: a default level the new default model can't
    // honour would be inherited by every story created afterwards.
    const nextThinking = levelForModel(
      models.find((m) => m.id === next)?.reasoning,
      thinking
    )
    setModelId(next)
    setThinking(nextThinking)
    startTransition(async () => {
      const result = await updateAppSettings({
        defaultModelId: next,
        defaultThinking: nextThinking,
      })
      if (!result.ok) {
        setModelId(previous.modelId)
        setThinking(previous.thinking)
        toast.error(result.error)
      }
    })
  }

  function handleThinkingChange(next: ThinkingLevel) {
    const previous = thinking
    setThinking(next)
    startTransition(async () => {
      const result = await updateAppSettings({ defaultThinking: next })
      if (!result.ok) {
        setThinking(previous)
        toast.error(result.error)
      }
    })
  }

  async function handleVerify() {
    setVerifying(true)
    try {
      const result = await verifyOpenRouterKey()
      if (result.ok) toast.success(result.message)
      else toast.error(result.message)
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : "Couldn't verify the key."
      )
    } finally {
      setVerifying(false)
    }
  }

  return (
    <div className="flex h-app flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
        <SidebarTrigger />
        <h1 className="text-sm font-medium">Settings</h1>
        <div className="flex-1" />
        <span className="font-mono text-xs text-muted-foreground">
          local-first
        </span>
        <span className="font-mono text-xs text-muted-foreground/40">·</span>
        {/* Settings are things you change; usage is a thing you read. It gets
            its own route, and this is the door from here to there. */}
        <Link
          href="/usage"
          className="font-mono text-xs text-muted-foreground/60 transition-colors hover:text-foreground"
        >
          usage
        </Link>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        {/* Bottom pad clears the home indicator; see app/page.tsx. */}
        <div className="mx-auto w-full max-w-2xl space-y-6 px-6 pt-8 pb-[max(2rem,env(safe-area-inset-bottom))]">
          <Card size="sm">
            <CardHeader>
              <CardTitle>OpenRouter</CardTitle>
              <CardDescription>
                Generation runs on the OPENROUTER_API_KEY configured for this
                deploy.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                variant="outline"
                size="sm"
                disabled={verifying}
                onClick={handleVerify}
              >
                {verifying ? (
                  <>
                    <Loader2 className="animate-spin" />
                    Verifying
                  </>
                ) : (
                  "Verify key"
                )}
              </Button>
            </CardContent>
          </Card>

          <Card size="sm">
            <CardHeader>
              <CardTitle>Generation defaults</CardTitle>
              <CardDescription>Applied to new stories.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <Label htmlFor="default-model">Default model</Label>
                <ModelCombobox
                  id="default-model"
                  models={models}
                  value={modelId}
                  onValueChange={handleModelChange}
                  disabled={isPending}
                />
                <ThinkingSelect
                  reasoning={
                    models.find((m) => m.id === modelId)?.reasoning ?? null
                  }
                  value={thinking}
                  onValueChange={handleThinkingChange}
                  disabled={isPending}
                />
                <p className="text-xs text-muted-foreground">
                  New stories start from this model and thinking level; each
                  story can override both in the inspector.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card size="sm">
            <CardHeader>
              <CardTitle>Appearance</CardTitle>
              <CardDescription>
                How draft zero looks while you write.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Theme</p>
                  <p className="text-xs text-muted-foreground">
                    Switch between light and dark.
                  </p>
                </div>
                <ThemeToggle />
              </div>
            </CardContent>
          </Card>
        </div>
      </ScrollArea>
    </div>
  )
}

export { SettingsView }
