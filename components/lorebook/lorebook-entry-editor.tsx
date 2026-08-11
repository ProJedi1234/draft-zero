"use client"

import { useId, useState } from "react"
import { Trash2, X } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { formatRelativeDate } from "@/lib/format"
import { LOREBOOK_CATEGORIES, type LorebookEntry } from "@/lib/types"

export function LorebookEntryEditor({
  entry,
  layout = "page",
}: {
  entry?: LorebookEntry
  layout?: "page" | "dialog"
}) {
  const uid = useId()
  const [priority, setPriority] = useState(entry?.priority ?? 50)

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor={`${uid}-name`}>Name</Label>
        <Input
          id={`${uid}-name`}
          defaultValue={entry?.name ?? ""}
          placeholder="Name this entry..."
        />
      </div>

      <div className="space-y-2">
        <Label>Category</Label>
        <Select
          defaultValue={entry?.category ?? "character"}
          items={LOREBOOK_CATEGORIES.map((c) => ({
            value: c.value,
            label: c.label,
          }))}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LOREBOOK_CATEGORIES.map((c) => (
              <SelectItem key={c.value} value={c.value}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>Trigger keys</Label>
        <div className="flex flex-wrap items-center gap-1.5">
          {(entry?.keys ?? []).map((k) => (
            <Badge key={k} variant="secondary" className="gap-1">
              {k}
              <X className="size-3 cursor-pointer" />
            </Badge>
          ))}
          <Input
            placeholder="Add key..."
            className="h-8 w-28"
            aria-label="Add trigger key"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Entry activates when a key appears in recent story text.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${uid}-content`}>Content</Label>
        <Textarea
          id={`${uid}-content`}
          defaultValue={entry?.content ?? ""}
          className="min-h-40"
          placeholder="What should the model know?"
        />
        <p className="text-xs text-muted-foreground">
          Injected into context when triggered.
        </p>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div>
          <Label>Enabled</Label>
          <p className="text-xs text-muted-foreground">
            Disabled entries never enter context.
          </p>
        </div>
        <Switch defaultChecked={entry?.enabled ?? true} />
      </div>

      <div className="flex items-center justify-between gap-4">
        <div>
          <Label>Always active</Label>
          <p className="text-xs text-muted-foreground">
            Stay in context even without a key match.
          </p>
        </div>
        <Switch defaultChecked={entry?.alwaysActive ?? false} />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-4">
          <Label>Priority</Label>
          <span className="font-mono text-xs text-muted-foreground">
            {priority}
          </span>
        </div>
        <Slider
          value={[priority]}
          min={0}
          max={100}
          step={5}
          onValueChange={(v) => setPriority(Array.isArray(v) ? v[0] : v)}
          aria-label="Priority"
        />
        <p className="text-xs text-muted-foreground">
          Higher priority survives context trimming longer.
        </p>
      </div>

      {layout === "page" && (
        <div className="flex items-center justify-between border-t pt-4">
          {entry ? (
            <span className="text-xs text-muted-foreground">
              Updated {formatRelativeDate(entry.updatedAt)}
            </span>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="destructive" size="sm">
              <Trash2 data-icon="inline-start" />
              Delete
            </Button>
            <Button size="sm">Save changes</Button>
          </div>
        </div>
      )}
    </div>
  )
}
