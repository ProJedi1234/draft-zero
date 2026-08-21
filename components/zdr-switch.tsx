"use client"

import * as React from "react"
import Link from "next/link"
import { ShieldCheck } from "lucide-react"

import { Switch } from "@/components/ui/switch"
import { OPENROUTER_PRIVACY_URL } from "@/lib/types"

/**
 * Why a zero-data-retention switch is on and cannot be turned off. Null is the
 * ordinary case: the writer owns the setting.
 *
 * "account" is the one this app cannot argue with — OpenRouter ORs its account
 * policy over every request, so a switch offering to turn it off would be
 * lying. "app" is the writer's own app-wide policy, which they can still lower,
 * just not from here: a per-story escape hatch on a global policy is how a
 * policy stops being one.
 */
export type ZdrLock = null | "account" | "app"

const LOCK_NOTE: Record<NonNullable<ZdrLock>, string> = {
  account: "Required by your OpenRouter account.",
  app: "Required by the app-wide policy.",
}

/**
 * The switch for "route only through providers that keep nothing", in the three
 * places it appears: app-wide in Settings, per profile in the profile editor,
 * and per story in the inspector.
 *
 * One component because the three must not drift — the same sentence, the same
 * lock states, the same link out. What differs is only who owns the value.
 */
function PrivacyLink() {
  return (
    <Link
      href={OPENROUTER_PRIVACY_URL}
      target="_blank"
      rel="noreferrer"
      className="underline underline-offset-2 hover:text-foreground"
    >
      OpenRouter privacy settings
    </Link>
  )
}

export function ZdrSwitch({
  id,
  checked,
  onCheckedChange,
  lock = null,
  disabled,
  hint,
  accountNote,
}: {
  id?: string
  /** The effective value: a locked switch is always shown on. */
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  lock?: ZdrLock
  disabled?: boolean
  /**
   * Replaces the default second line. Used where the surrounding surface has
   * already said what the switch does and the space is better spent on what it
   * costs here.
   */
  hint?: string
  /**
   * What the OpenRouter account already enforces on its own, when that is some
   * of the model groups rather than all of them — too partial to lock this
   * switch, too important to leave the writer to discover one refused
   * generation at a time.
   */
  accountNote?: string
}) {
  // Base UI puts this on the hidden input the label points at, so the caption
  // is clickable. Generated when the caller has no id of its own to lend.
  const inputId = React.useId()
  const switchId = id ?? inputId
  const locked = lock !== null
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <label
          htmlFor={switchId}
          className="flex items-center gap-1.5 text-sm font-medium"
        >
          <ShieldCheck aria-hidden className="size-3.5 shrink-0 opacity-70" />
          Zero data retention
        </label>
        <p className="text-xs text-muted-foreground">
          {locked
            ? LOCK_NOTE[lock]
            : (hint ?? "Only route to providers that keep nothing.")}{" "}
          {lock === "account" ? (
            <PrivacyLink />
          ) : lock === "app" ? (
            <Link
              href="/settings"
              className="underline underline-offset-2 hover:text-foreground"
            >
              Settings
            </Link>
          ) : null}
        </p>
        {/* Only where the switch is not already saying it: a locked switch has
            said everything this line would, and said it about every model. */}
        {accountNote && !locked ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {accountNote} <PrivacyLink />
          </p>
        ) : null}
      </div>
      <Switch
        id={switchId}
        // A locked switch reads as on because it IS on: the request goes out
        // with zero data retention either way, and showing the writer's own
        // false there would describe a setting nothing honours.
        checked={locked || checked}
        disabled={disabled || locked}
        onCheckedChange={onCheckedChange}
        aria-label="Zero data retention"
      />
    </div>
  )
}
