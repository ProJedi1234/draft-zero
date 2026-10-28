const listeners = new Set<(storyId: string | null) => void>()

/** Resource reads that aren't part of the workspace also follow the shared channel. */
export const storyChanges = {
  subscribe(listener: (storyId: string | null) => void) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
  publish(storyId: string | null) {
    for (const listener of listeners) listener(storyId)
  },
}
