"use client"

// components/offline/offline-panel.tsx — "What do I actually have?"
//
// The question people have offline is not whether they are offline; the phone
// already said that. It is what is still readable, how old it is, what is
// waiting to go out, and whether the fault is theirs or the server's. Those
// four answers live here, in one screen, reachable from the chip.
//
// Absence is rendered rather than hidden. A story with no cached manuscript is
// listed and dimmed, because hiding it makes a story you cannot open look like
// a story that was deleted.

import * as React from "react"
import { Check, CloudOff, Loader2, X } from "lucide-react"

import { useOffline } from "@/components/offline/offline-provider"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { useStoreView } from "@/hooks/use-store"
import { probeConnection, type ProbeResult } from "@/lib/net/connection"
import { clientStore } from "@/lib/store/store"
import {
  cachedStoryIds,
  subscribe as subscribeWorkspaceCache,
} from "@/lib/story/workspace-cache"
import { cn } from "@/lib/utils"

export function OfflinePanel() {
  const offline = useOffline()
  if (offline === null) return null

  return (
    <Sheet open={offline.panelOpen} onOpenChange={offline.setPanelOpen}>
      <SheetContent side="right" className="gap-0">
        <SheetHeader>
          <SheetTitle>What you have offline</SheetTitle>
          <SheetDescription>
            <SnapshotAge />
          </SheetDescription>
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-5 px-4 pb-4">
            <StoryInventory />
            <Separator />
            <HeldWrites />
          </div>
        </ScrollArea>
        <div className="border-t p-4">
          <ConnectionTest />
        </div>
      </SheetContent>
    </Sheet>
  )
}

function SnapshotAge() {
  const view = useStoreView()
  // Read through the view so this re-renders when a snapshot lands; the
  // timestamp itself is not part of StoreView.
  void view
  const at = clientStore.getLastCompleteApplyAt()
  if (at === 0) return <>No snapshot has landed on this device yet.</>
  return <>Snapshot taken {relativeTime(at)}.</>
}

function StoryInventory() {
  const { stories } = useStoreView()

  // The manuscript cache has its own subscription, separate from the store's:
  // a payload landing changes which stories are openable offline without
  // changing a single story ROW. Held as state rather than read through
  // useSyncExternalStore because cachedStoryIds allocates, and a snapshot with
  // a new identity on every call is an infinite render.
  const [cached, setCached] = React.useState<ReadonlySet<string>>(
    () => new Set(cachedStoryIds())
  )
  React.useEffect(() => {
    const read = () => setCached(new Set(cachedStoryIds()))
    // Once on mount as well as on change: payloads can land between this
    // component rendering and its effect running, and the subscription only
    // reports what happens after it exists.
    read()
    return subscribeWorkspaceCache(read)
  }, [])

  if (stories.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No stories are saved on this device.
      </p>
    )
  }

  const full = stories.filter((story) => cached.has(story.id))

  return (
    <div className="space-y-2">
      <ul className="space-y-1">
        {stories.map((story) => {
          const held = cached.has(story.id)
          return (
            <li
              key={story.id}
              className={cn(
                "flex items-center gap-2 text-sm",
                !held && "opacity-50"
              )}
            >
              <span className="min-w-0 flex-1 truncate">{story.title}</span>
              <span
                className={cn(
                  "shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
                  held
                    ? "border-foreground/20 text-foreground"
                    : "border-dashed text-muted-foreground"
                )}
              >
                {held ? "full" : "title only"}
              </span>
            </li>
          )
        })}
      </ul>
      <p className="text-xs text-muted-foreground">
        {full.length} of {stories.length}{" "}
        {stories.length === 1 ? "story is" : "stories are"} held in full. The
        rest need a connection to open.
      </p>
    </div>
  )
}

function HeldWrites() {
  const view = useStoreView()
  const held = clientStore.getState().pending

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Held to send · {view.pendingCount}</p>
      {held.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nothing is waiting. Every change you have made is on the server.
        </p>
      ) : (
        <ul className="space-y-1">
          {held.map((mutation) => (
            <li
              key={mutation.id}
              className="flex items-center gap-2 text-xs text-muted-foreground"
            >
              <span className="size-1.5 shrink-0 rounded-full bg-warning" />
              <span className="min-w-0 flex-1 truncate">{mutation.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * Three rows, each of which the browser can actually determine.
 *
 * The mockup for this had a DNS row. A page cannot test DNS — a failed fetch
 * is a failed fetch, and inventing a resolution step would be a diagnosis the
 * app is making up. What it CAN separate is nothing answered, something
 * answered too slowly, and the server answering that it is broken, and those
 * three genuinely call for different reactions.
 */
function ConnectionTest() {
  const [result, setResult] = React.useState<ProbeResult | null>(null)
  const [testing, setTesting] = React.useState(false)

  const run = async () => {
    setTesting(true)
    try {
      setResult(await probeConnection())
    } finally {
      setTesting(false)
    }
  }

  const deviceOnline =
    typeof navigator === "undefined" ? true : navigator.onLine

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Connection</p>
        <Button variant="outline" size="xs" onClick={run} disabled={testing}>
          {testing ? <Loader2 className="animate-spin" /> : null}
          {testing ? "Testing" : "Test"}
        </Button>
      </div>

      <ul className="space-y-1.5 text-xs">
        <TestRow
          label="This device's network"
          state={deviceOnline ? "pass" : "fail"}
          note={deviceOnline ? undefined : "no interface up"}
        />
        <TestRow
          label="draft zero server"
          state={result === null ? "unknown" : result.ok ? "pass" : "fail"}
          note={describeProbe(result)}
        />
      </ul>

      <p className="text-xs text-muted-foreground">{verdict(result)}</p>
    </div>
  )
}

function TestRow({
  label,
  state,
  note,
}: {
  label: string
  state: "pass" | "fail" | "unknown"
  note?: string
}) {
  return (
    <li className="flex items-center gap-2">
      {state === "pass" ? (
        <Check className="size-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
      ) : state === "fail" ? (
        <X className="size-3 shrink-0 text-destructive" />
      ) : (
        <span className="size-3 shrink-0 rounded-full border border-dashed border-muted-foreground/40" />
      )}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {note === undefined ? null : (
        <span className="shrink-0 text-muted-foreground">{note}</span>
      )}
    </li>
  )
}

function describeProbe(result: ProbeResult | null): string | undefined {
  if (result === null) return "not tested"
  if (result.ok) return `${result.latencyMs}ms`
  switch (result.reason) {
    case "forced":
      return "forced offline"
    case "timeout":
      return "timed out"
    case "server-error":
      return `HTTP ${result.status}`
    case "unreachable":
      return "no answer"
  }
}

function verdict(result: ProbeResult | null): string {
  if (result === null) {
    return "Test the connection to find out where it is failing."
  }
  if (result.ok) return "Everything is reachable."
  switch (result.reason) {
    case "forced":
      return "Offline is being simulated from the Developer settings. Turn it off there."
    case "timeout":
      return "Something is on the path but not letting the request through — often a captive portal or a VPN."
    case "server-error":
      return "Your network is fine. The server is answering, and answering that it is broken."
    case "unreachable":
      return "Nothing answered. Either this device has no route out, or the server is down."
  }
}

/** Coarse on purpose — "2 minutes" is the answer, not "2 minutes 14 seconds". */
function relativeTime(at: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000))
  if (seconds < 60) return "moments ago"
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? "" : "s"} ago`
}

export { CloudOff as OfflinePanelIcon }
