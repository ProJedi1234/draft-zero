"use client"

// hooks/use-model-endpoints.ts — The upstream endpoints serving one model, for
// the provider picker. Fetched through a server action rather than passed down
// from the story page: the writer can change models without a navigation, and
// the throughput figures are a rolling 30-minute measurement that has no
// business being baked into a page render.

import * as React from "react"

import { getModelEndpoints } from "@/lib/actions/models"
import type { ModelEndpoint } from "@/lib/types"

/**
 * Endpoints for `modelId`, refetched whenever it changes. `endpoints` is [] both
 * before the first response and when the model has none — the picker treats
 * those the same way, by rendering nothing.
 *
 * State holds the model each list belongs to rather than a separate loading
 * flag, which makes both derived: a list is current only when it is the list for
 * the model being asked about. That is also what drops a late response for a
 * model the writer has already switched away from, since the endpoint list is
 * per-model and a stale arrival would offer providers for the previous one.
 */
export function useModelEndpoints(modelId: string): {
  endpoints: ModelEndpoint[]
  loading: boolean
} {
  const [loaded, setLoaded] = React.useState<{
    modelId: string
    endpoints: ModelEndpoint[]
  } | null>(null)

  React.useEffect(() => {
    let active = true
    getModelEndpoints(modelId).then(
      (result) => {
        if (active)
          setLoaded({ modelId, endpoints: result.ok ? result.data : [] })
      },
      () => {
        // A failed action is not worth a toast: the picker's absence is the
        // message, and Auto — what the story is already on — still works.
        if (active) setLoaded({ modelId, endpoints: [] })
      }
    )
    return () => {
      active = false
    }
  }, [modelId])

  const current = loaded?.modelId === modelId ? loaded : null
  return { endpoints: current?.endpoints ?? [], loading: current === null }
}
