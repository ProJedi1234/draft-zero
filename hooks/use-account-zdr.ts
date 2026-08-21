"use client"

// hooks/use-account-zdr.ts — Whether the OpenRouter account enforces zero data
// retention, for the toggles that lock when it does.
//
// Fetched after mount rather than passed down: it is a fact about an external
// account, not about the story or the settings row, and the first answer costs
// a round trip to OpenRouter that no page should render behind. Every later
// answer comes from a process-level cache, so the wait is once an hour at worst.

import * as React from "react"

import { getAccountZdrPolicy } from "@/lib/actions/zdr"
import type { AccountZdrPolicy } from "@/lib/types"

/**
 * "unknown" until the answer arrives, and for good if it never does — the
 * toggles read that as "not locked", which leaves the writer in control rather
 * than guessing on their behalf.
 */
export function useAccountZdr(): AccountZdrPolicy {
  const [policy, setPolicy] = React.useState<AccountZdrPolicy>("unknown")

  React.useEffect(() => {
    let active = true
    getAccountZdrPolicy().then(
      (next) => {
        if (active) setPolicy(next)
      },
      () => {
        // A failed action is not worth a toast: "unknown" is already what the
        // control is showing, and the writer can still set the toggle by hand.
      }
    )
    return () => {
      active = false
    }
  }, [])

  return policy
}
