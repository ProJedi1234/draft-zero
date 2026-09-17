"use client"

// components/offline/offline-inert.tsx — Makes a whole region of controls
// visibly unavailable while offline, without editing every control in it.
//
// These are the server-synced controls (hooks/use-server-synced.ts): a model
// choice, a slider, a settings switch. Offline their action throws, the hook
// calls reset(), and the control silently springs back to where it was — a
// spinner that runs into a timeout and then pretends nothing happened, which
// is the exact failure "nothing fake stays fake" exists to prevent.
//
// `inert` rather than a pointer-events class, because the requirement is not
// only that a click does nothing. It must also drop out of the tab order and
// out of the accessibility tree, or a keyboard or VoiceOver user walks into a
// control that a sighted user can see is unavailable. One attribute does all
// three; a CSS class does none of them.
//
// Deliberately NOT applied to: the composer's text area (writing needs no
// network), undo and redo and lore edits (they queue), or the Developer card
// in settings — turning simulated offline off has to stay reachable while
// simulated offline is on, or the switch is a trap.

import { useIsOffline } from "@/hooks/use-connection"
import { cn } from "@/lib/utils"

export function OfflineInert({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  const offline = useIsOffline()

  return (
    <div
      inert={offline}
      className={cn(
        offline && "pointer-events-none opacity-50 saturate-50",
        "transition-opacity",
        className
      )}
    >
      {children}
    </div>
  )
}
