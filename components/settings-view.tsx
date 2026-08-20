"use client"

import * as React from "react"
import Link from "next/link"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

import { GenerationDefaultsCard } from "@/components/settings/generation-defaults-card"
import { ModelProfilesCard } from "@/components/settings/model-profiles-card"
import { ThemeToggle } from "@/components/theme-toggle"
import { ZdrSwitch } from "@/components/zdr-switch"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { useAccountZdr } from "@/hooks/use-account-zdr"
import { useServerSyncedValue } from "@/hooks/use-server-synced"
import { updateAppSettings, verifyOpenRouterKey } from "@/lib/actions/settings"
import type { AppSettings, ModelProfile, OpenRouterModel } from "@/lib/types"

function SettingsView({
  settings,
  models,
  profiles,
  followerCounts,
}: {
  settings: AppSettings
  models: OpenRouterModel[]
  profiles: ModelProfile[]
  /** Stories per profile id, for the editor's "followed by N stories" line. */
  followerCounts: Record<string, number>
}) {
  const [verifying, setVerifying] = React.useState(false)
  const [, startTransition] = React.useTransition()
  const accountZdr = useAccountZdr()
  // Follows the settings row while mounted — the policy is app-wide, so another
  // device turning it on has to land here — but never while this device's own
  // write is still in flight. See hooks/use-server-synced.ts.
  const zdr = useServerSyncedValue(settings.requireZdr)
  const requireZdr = zdr.value

  function handleZdrChange(next: boolean) {
    const previous = requireZdr
    zdr.write(next)
    startTransition(async () => {
      let ok = false
      let message = "Couldn't save the policy."
      try {
        const result = await updateAppSettings({ requireZdr: next })
        ok = result.ok
        if (!result.ok) message = result.error
      } catch (error) {
        message =
          error instanceof Error && error.message ? error.message : message
      }
      if (ok) {
        zdr.settle()
      } else {
        zdr.reset(previous)
        toast.error(message)
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
            <CardContent className="space-y-6">
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
              <ZdrSwitch
                id="require-zdr"
                checked={requireZdr}
                onCheckedChange={handleZdrChange}
                lock={accountZdr === "enforced" ? "account" : null}
                hint="Every story and profile, whatever they say for themselves. Costs you the providers that retain prompts, and the models only they serve."
              />
            </CardContent>
          </Card>

          <GenerationDefaultsCard defaults={settings.defaultGeneration} />

          <ModelProfilesCard
            profiles={profiles}
            models={models}
            defaults={settings.defaultGeneration}
            requireZdr={requireZdr}
            defaultProfileId={settings.defaultProfileId}
            followerCounts={followerCounts}
          />

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
