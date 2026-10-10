"use client"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { useMobileReturn } from "@/hooks/use-composer-return"

// Outside OfflineInert because the preference lives in this device's storage
// and never touches the server.
export function KeyboardCard() {
  const [preference, setPreference] = useMobileReturn()

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Keyboard</CardTitle>
        <CardDescription>
          How the composer treats a touch keyboard. Saved on this device only.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <label htmlFor="return-sends" className="text-sm font-medium">
              Return sends
            </label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              On, the Return key sends your move and a button in the composer
              inserts line breaks. Off, Return inserts a new line. Hardware
              keyboards always send with Return and break lines with Shift.
            </p>
          </div>
          <Switch
            id="return-sends"
            checked={preference === "send"}
            onCheckedChange={(on) => setPreference(on ? "send" : "newline")}
            className="mt-0.5 shrink-0"
          />
        </div>
      </CardContent>
    </Card>
  )
}
