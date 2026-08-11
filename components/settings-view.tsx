"use client"

import * as React from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

import { ThemeToggle } from "@/components/theme-toggle"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { useAutosave } from "@/hooks/use-autosave"
import { updateAppSettings } from "@/lib/actions/settings"
import { getGenerationProvider } from "@/lib/generation/provider"
import { MOCK_MODELS } from "@/lib/mock-data"
import type { AppSettings } from "@/lib/types"

const MODEL_ITEMS = MOCK_MODELS.map((m) => ({ value: m.id, label: m.name }))

function SettingsView({ settings }: { settings: AppSettings }) {
  // Uncontrolled-after-mount (§4.2): the input owns its text; this mirror only
  // feeds the helper copy and the verify button.
  const [key, setKey] = React.useState(settings.openRouterKey)
  const [verifying, setVerifying] = React.useState(false)
  const [modelId, setModelId] = React.useState(settings.defaultModelId)
  const [isPending, startTransition] = React.useTransition()

  const keyAutosave = useAutosave(
    (value: string) => updateAppSettings({ openRouterKey: value }),
    600
  )

  function handleModelChange(next: string) {
    if (next === "" || next === modelId) return
    const previous = modelId
    setModelId(next)
    startTransition(async () => {
      const result = await updateAppSettings({ defaultModelId: next })
      if (!result.ok) {
        setModelId(previous)
        toast.error(result.error)
      }
    })
  }

  async function handleVerify() {
    // Don't verify a key the DB hasn't caught up with yet.
    keyAutosave.flush()
    setVerifying(true)
    try {
      const result = await getGenerationProvider().verifyKey(key)
      if (result.ok) toast.success(result.message)
      else toast.error(result.message)
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : "Couldn't verify that key."
      )
    } finally {
      setVerifying(false)
    }
  }

  return (
    <div className="flex h-app flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
        <SidebarTrigger />
        <Separator orientation="vertical" className="h-4" />
        <h1 className="text-sm font-medium">Settings</h1>
        <div className="flex-1" />
        <span className="font-mono text-xs text-muted-foreground">
          local-first
        </span>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto w-full max-w-2xl space-y-6 px-6 py-8">
          <Card size="sm">
            <CardHeader>
              <CardTitle>OpenRouter</CardTitle>
              <CardDescription>
                Connect your account to generate text. Keys are stored locally.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <Label htmlFor="or-key">API key</Label>
                <Input
                  id="or-key"
                  type="password"
                  placeholder="sk-or-v1-..."
                  defaultValue={settings.openRouterKey}
                  onChange={(event) => {
                    const value = event.target.value
                    setKey(value)
                    keyAutosave.schedule(value)
                  }}
                  onBlur={() => keyAutosave.flush()}
                />
                <p className="text-xs text-muted-foreground">
                  {key.trim() === "" ? "Not connected." : "Key stored locally."}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="mt-4"
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
                <Select
                  value={modelId}
                  onValueChange={(value) => {
                    handleModelChange(typeof value === "string" ? value : "")
                  }}
                  items={MODEL_ITEMS}
                  disabled={isPending}
                >
                  <SelectTrigger id="default-model" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MOCK_MODELS.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  New stories start from this model; each story can override it
                  in the inspector.
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
