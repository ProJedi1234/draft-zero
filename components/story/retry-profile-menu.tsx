"use client"

import * as React from "react"
import { ChevronDown, Star, type LucideIcon } from "lucide-react"

import { settingsSummary } from "@/lib/settings-summary"
import type { ModelProfile, OpenRouterModel } from "@/lib/types"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

/**
 * What the retry menu needs to know, supplied once for the whole editor.
 *
 * A context rather than props because the two buttons that carry this control
 * sit on opposite sides of the workspace — one in the composer, one in a
 * passage's action cluster — and the canvas between them has no interest in
 * profiles at all. Threading a switcher's catalogue through it would put four
 * props on three components to serve one menu.
 */
export interface RetryProfiles {
  profiles: ModelProfile[]
  /** The catalogue, for the one-line summary under each profile's name. */
  models: OpenRouterModel[]
  /** Starred in the list, exactly as in the inspector's switcher. */
  defaultProfileId: string | null
  /** The profile the story follows, or null when it is Custom. */
  currentProfileId: string | null
  /** Regenerates the last passage under that profile, for that take only. */
  onRetryWithProfile: (profileId: string) => void
}

const RetryProfilesContext = React.createContext<RetryProfiles | null>(null)

export function RetryProfilesProvider({
  value,
  children,
}: {
  value: RetryProfiles
  children: React.ReactNode
}) {
  return (
    <RetryProfilesContext.Provider value={value}>
      {children}
    </RetryProfilesContext.Provider>
  )
}

/**
 * Retry, with a caret beside it that offers the same passage under a different
 * profile.
 *
 * The plain button is untouched by all of this: one click still retries under
 * the story's own settings, because that is what a writer rolling for a better
 * sentence wants and the profile list is a different question. The caret is
 * only rendered when there is a profile the story is not already following —
 * with nothing to choose between, a chevron would open a menu whose only row
 * is the button to its left.
 *
 * `revealCaret` fades the caret in on hover of the pair, for the composer's
 * toolbar, where five ghost buttons already compete and a sixth glyph at rest
 * is one too many. Its slot is laid out either way, so the toolbar never
 * reflows under a pointer on its way to Send. Where there is no pointer to
 * hover with it is simply always drawn — the same reason the passage cluster
 * is permanently visible on touch.
 */
export function RetryButton({
  icon: Icon,
  label,
  size,
  disabled,
  onRetry,
  revealCaret = false,
}: {
  icon: LucideIcon
  label: string
  size: "xs" | "sm"
  disabled: boolean
  onRetry: () => void
  revealCaret?: boolean
}) {
  const context = React.useContext(RetryProfilesContext)
  const [open, setOpen] = React.useState(false)

  const alternatives =
    context?.profiles.filter(
      (profile) => profile.id !== context.currentProfileId
    ) ?? []
  // A story can follow a profile that has since been deleted on another device;
  // the server resolves that to Custom, and so does this.
  const current =
    context?.profiles.find(
      (profile) => profile.id === context.currentProfileId
    ) ?? null

  return (
    <span className="group/retry relative inline-flex items-center">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size={size === "sm" ? "icon-sm" : "icon-xs"}
              aria-label={label}
              disabled={disabled}
              onClick={onRetry}
            />
          }
        >
          <Icon />
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>

      {context && alternatives.length > 0 && (
        <DropdownMenu open={open} onOpenChange={setOpen}>
          {/* No tooltip on this one, unlike every other icon button in the
              app: a base-ui trigger owns its element's handlers, so wrapping
              this in a TooltipTrigger merges the two sets of props and the
              caret quietly stops opening anything. The aria-label carries the
              name, and the menu it opens says the rest. */}
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size={size === "sm" ? "icon-caret-sm" : "icon-caret-xs"}
                aria-label="Retry with a profile"
                disabled={disabled}
                // The hairline is the only thing saying these two buttons are
                // one control; it arrives with the hover fill they share.
                className={cn(
                  "border-l border-transparent transition-opacity group-hover/retry:border-border",
                  // Keyed to whether the device HAS a pointer, not to how wide
                  // its screen is: an iPad in landscape is wider than `md` and
                  // has no hover, so a width-gated reveal would hide this
                  // caret there for good.
                  revealCaret &&
                    "pointer-fine:opacity-0 pointer-fine:group-focus-within/retry:opacity-100 pointer-fine:group-hover/retry:opacity-100 pointer-fine:aria-expanded:opacity-100"
                )}
              />
            }
          >
            <ChevronDown />
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end" className="max-h-80 w-72">
            {context.profiles.map((profile) => (
              <DropdownMenuItem
                key={profile.id}
                className="items-start normal-case"
                onClick={() => context.onRetryWithProfile(profile.id)}
              >
                {/* Always rendered, invisible when not the default: the names
                    have to line up down the column. */}
                <Star
                  aria-hidden
                  className={cn(
                    "mt-0.5 shrink-0",
                    profile.id === context.defaultProfileId
                      ? "fill-current"
                      : "invisible"
                  )}
                />
                <span className="flex min-w-0 flex-col tracking-normal">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-sm font-medium">
                      {profile.name}
                    </span>
                    {/* Which row plain Retry would have used. Without it the
                        menu is a list of models with no mark for the one the
                        button beside it already runs. */}
                    {profile.id === context.currentProfileId && (
                      <Badge variant="secondary" className="shrink-0">
                        current
                      </Badge>
                    )}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {settingsSummary(profile.settings, context.models)}
                  </span>
                </span>
              </DropdownMenuItem>
            ))}

            {/* The promise this control lives or dies by: trying a model on one
                paragraph must not quietly re-point the story, or every
                experiment costs the writer their settings. */}
            <p className="mt-1 border-t px-2 pt-2 pb-1 text-xs text-muted-foreground">
              This take only. The story keeps{" "}
              {current ? (
                <>
                  following{" "}
                  <span className="font-medium text-foreground">
                    {current.name}
                  </span>
                </>
              ) : (
                "its own settings"
              )}
              .
            </p>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </span>
  )
}
