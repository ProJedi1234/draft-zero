"use client"

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
import { DEFAULT_GENERATION_SETTINGS, MOCK_MODELS } from "@/lib/mock-data"

function SettingsView() {
  return (
    <div className="flex h-svh flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
        <SidebarTrigger />
        <Separator orientation="vertical" className="h-4" />
        <h1 className="text-sm font-medium">Settings</h1>
        <div className="flex-1" />
        <span className="font-mono text-xs text-muted-foreground">
          local preview
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
                <Input id="or-key" type="password" placeholder="sk-or-v1-..." />
                <p className="text-xs text-muted-foreground">
                  Not connected. Generation is disabled in this preview.
                </p>
              </div>
              <Button variant="outline" size="sm" className="mt-4">
                Verify key
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
                  defaultValue={DEFAULT_GENERATION_SETTINGS.modelId}
                  items={MOCK_MODELS.map((m) => ({
                    value: m.id,
                    label: m.name,
                  }))}
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
