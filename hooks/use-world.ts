"use client"

import * as React from "react"
import type { WorldOp, WorldState } from "@/lib/services/world.schema"
import type { ActionResult } from "@/lib/types"
import { storyChanges } from "@/lib/sync/story-changes"
import { syncClientId } from "@/lib/sync/client"

export function useWorld(storyId: string, enabled = true) {
  const [state, setState] = React.useState<WorldState | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const revision = React.useRef(0)
  const queue = React.useRef(Promise.resolve())

  React.useEffect(() => {
    if (!enabled) return
    let disposed = false
    let controller: AbortController | null = null
    const refresh = async () => {
      controller?.abort()
      controller = new AbortController()
      const own = ++revision.current
      try {
        const response = await fetch(`/api/stories/${storyId}/world`, {
          cache: "no-store",
          signal: controller.signal,
        })
        const result: ActionResult<{ state: WorldState }> =
          await response.json()
        if (disposed || own !== revision.current) return
        if (result.ok) {
          setState(result.data.state)
          setError(null)
        } else setError(result.error)
      } catch (error) {
        if (!disposed && own === revision.current && !controller.signal.aborted)
          setError(
            error instanceof Error ? error.message : "Couldn't load the world."
          )
      }
    }
    void refresh()
    const unsubscribe = storyChanges.subscribe((changed) => {
      if (changed === null || changed === storyId) void refresh()
    })
    return () => {
      disposed = true
      controller?.abort()
      unsubscribe()
    }
  }, [storyId, enabled])

  const patch = React.useCallback(
    (ops: WorldOp[]): Promise<ActionResult<{ state: WorldState }>> => {
      const run = async (): Promise<ActionResult<{ state: WorldState }>> => {
        ++revision.current
        try {
          const response = await fetch(`/api/stories/${storyId}/world/patch`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-sync-origin": syncClientId,
            },
            body: JSON.stringify({ ops }),
          })
          const result: ActionResult<{ state: WorldState }> =
            await response.json()
          ++revision.current
          if (result.ok) {
            setState(result.data.state)
            setError(null)
          }
          return result
        } catch {
          return { ok: false, error: "Couldn't save the world." }
        }
      }
      const result = queue.current.then(run)
      queue.current = result.then(() => {})
      return result
    },
    [storyId]
  )

  return { state, error, patch }
}
