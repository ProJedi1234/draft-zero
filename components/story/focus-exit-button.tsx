"use client"

import { Minimize2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

/**
 * The way out of focus mode without a keyboard. Rendered only while focus mode
 * is on, so there is never a chrome-less corner control competing with the
 * header's own row.
 *
 * Keyed to whether the device HAS a pointer, not to how wide its screen is: an
 * iPad in landscape is wider than `lg` and cannot hover, so a width-gated
 * reveal would leave focus mode with no exit at all there. On a mouse it rests
 * invisible and comes back under the cursor or a Tab.
 *
 * Positioned against the safe area itself, not the shell's padding: absolute
 * offsets resolve from the padding box, so `top-2` alone would put this under
 * the notch.
 */
export function FocusExitButton({ onExit }: { onExit: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Exit focus mode"
            onClick={onExit}
            className="absolute top-[calc(0.5rem+env(safe-area-inset-top))] right-[calc(0.5rem+env(safe-area-inset-right))] z-20 bg-surface-glass shadow-lg backdrop-blur-md pointer-fine:opacity-0 pointer-fine:hover:opacity-100 pointer-fine:focus-visible:opacity-100"
          />
        }
      >
        <Minimize2 />
      </TooltipTrigger>
      <TooltipContent>Exit focus mode (⌘.)</TooltipContent>
    </Tooltip>
  )
}
