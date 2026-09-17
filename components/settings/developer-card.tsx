"use client"

// components/settings/developer-card.tsx — The switches that exist to break
// the app on purpose.
//
// Right now there is one, and it is here rather than behind a build flag
// because the thing it tests is a phone. Offline behaviour cannot be checked
// in a desktop devtools panel — the failure is an installed PWA on iOS with no
// route out, and the only way to stand in front of that is to be holding one.
// Shipping the switch is what makes that possible without airplane mode and
// without losing the session to a reload.

import { CloudOff } from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { useForcedOffline } from "@/hooks/use-connection"

export function DeveloperCard() {
  const [forced, setForced] = useForcedOffline()

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Developer</CardTitle>
        <CardDescription>
          For testing how draft zero behaves when things go wrong.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <label
              htmlFor="force-offline"
              className="flex items-center gap-1.5 text-sm font-medium"
            >
              <CloudOff className="size-3.5" />
              Simulate offline
            </label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Behaves as though the network were gone, including for the service
              worker — so a reload stays offline too. Survives restarting the
              app; turn it off here, or add{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-[11px]">
                ?offline=0
              </code>{" "}
              to the URL.
            </p>
          </div>
          <Switch
            id="force-offline"
            checked={forced}
            onCheckedChange={setForced}
            className="mt-0.5 shrink-0"
          />
        </div>
      </CardContent>
    </Card>
  )
}
