"use client"

// components/offline/offline-composer-action.tsx — What stands where Continue
// and Send were, while offline.
//
// The composer's TEXT AREA stays live and is untouched by any of this. You can
// keep writing in a tunnel, and the words are kept on the device. What cannot
// happen is a generation, so the buttons that start one are replaced rather
// than greyed — and replaced by the one control that helps, because this is
// the most-reached-for spot on the screen and the top-right chip is the
// hard-to-reach end of a phone.
//
// "Held on this device" rather than "Saved" is the whole honesty of the
// feature in three words. The draft is in IndexedDB here and has not reached
// the server, so it is not on the iPad and it is not in a backup. Saying
// "saved" would imply a sync that has not happened.

import { CloudOff } from "lucide-react"

import { useOffline } from "@/components/offline/offline-provider"
import { Button } from "@/components/ui/button"

export function OfflineComposerAction() {
  const offline = useOffline()

  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="hidden truncate text-xs text-muted-foreground sm:inline">
        Held on this device
      </span>
      <Button
        variant="outline"
        size="sm"
        onClick={() => offline?.setPanelOpen(true)}
        className="shrink-0 border-warning/40 text-warning hover:bg-warning/10"
      >
        <CloudOff />
        Offline
      </Button>
    </div>
  )
}
