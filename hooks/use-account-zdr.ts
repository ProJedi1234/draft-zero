"use client"

// hooks/use-account-zdr.ts — What the OpenRouter account already enforces, for
// the switches that lock when it does.
//
// Fetched after mount rather than passed down: it is a fact about an external
// account, not about the story or the settings row, and the first answer costs
// a round trip to OpenRouter that no page should render behind. Every later
// answer comes from a process-level cache, so the wait is once an hour at worst.
//
// Two hooks because there are two questions. A control with a model in front of
// it asks about that model's group — OpenRouter's privacy settings are five
// per-group toggles, and "does my account enforce this" has no single answer.
// The app-wide switch in Settings has no model, so it asks about all five.

import * as React from "react"

import { getAccountZdrForModel, getAccountZdrPolicies } from "@/lib/actions/zdr"
import {
  ZDR_GROUPS,
  type AccountZdrPolicies,
  type AccountZdrPolicy,
} from "@/lib/types"

/** Before any answer, and after one that never came. Locks nothing. */
const UNKNOWN: AccountZdrPolicies = Object.fromEntries(
  ZDR_GROUPS.map((group) => [group, "unknown" as const])
) as AccountZdrPolicies

/**
 * Whether the account forces zero data retention on `modelId`'s group.
 *
 * Refetched when the model moves to a different group — switching from Claude
 * to Grok is a different question with a different answer, and the cached one
 * would lock a switch that should be free (or free one that should be locked).
 */
export function useAccountZdrForModel(modelId: string): AccountZdrPolicy {
  const [state, setState] = React.useState<{
    modelId: string
    policy: AccountZdrPolicy
  } | null>(null)

  React.useEffect(() => {
    let active = true
    getAccountZdrForModel(modelId).then(
      (policy) => {
        if (active) setState({ modelId, policy })
      },
      () => {
        // A failed action is not worth a toast: "unknown" is already what the
        // control is showing, and the writer can still set the switch by hand.
      }
    )
    return () => {
      active = false
    }
  }, [modelId])

  // An answer is only current if it is the answer for the model being asked
  // about; a late arrival for the previous one would describe another group.
  return state?.modelId === modelId ? state.policy : "unknown"
}

/** Every group at once, for the app-wide switch. */
export function useAccountZdrPolicies(): AccountZdrPolicies {
  const [policies, setPolicies] = React.useState<AccountZdrPolicies>(UNKNOWN)

  React.useEffect(() => {
    let active = true
    getAccountZdrPolicies().then(
      (next) => {
        if (active) setPolicies(next)
      },
      () => {}
    )
    return () => {
      active = false
    }
  }, [])

  return policies
}
