// lib/net/debug.ts — Forced offline, for working on the offline UI without
// unplugging anything.
//
// Three properties make this worth having over the browser's own offline
// checkbox, and all three are the reason it is a persisted app flag rather
// than a React state:
//
//   It survives a reload. Cold-booting the app while it believes it is offline
//   is the case most worth testing and the one a devtools toggle loses the
//   moment you refresh.
//   It reaches the service worker, so navigations fail too. A flag the page
//   alone knows about cannot fake that, and "the document would not load" is
//   the failure this whole feature exists to fix.
//   It survives a browser that has no devtools, which is every phone the app
//   is actually used on.
//
// Reachable three ways: the Developer section in settings, the `?offline=1`
// query parameter, and `window.__draftZero.offline(true)` from a console.

const STORAGE_KEY = "draft-zero:force-offline"

/** Matches the message lib/net/debug's counterpart in public/sw.js listens for. */
const SW_MESSAGE = "dz-force-offline"

type Listener = (forced: boolean) => void

const listeners = new Set<Listener>()

let forced = false
let hydrated = false

function readStored(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1"
  } catch {
    // Private mode, or storage disabled. Not forced is the safe reading.
    return false
  }
}

function writeStored(value: boolean): void {
  try {
    if (value) window.localStorage.setItem(STORAGE_KEY, "1")
    else window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // The flag still works for this page; it just will not survive a reload.
  }
}

/**
 * Push the flag into the service worker.
 *
 * Re-sent on every call and on every boot rather than stored worker-side: a
 * worker that restarted into forced-offline with no page able to reach it
 * would be a brick that survives the reload meant to clear it.
 */
function tellServiceWorker(value: boolean): void {
  // Guarded on navigator itself, not just the property: this module is reached
  // from the mutation queue, which runs under bun in tests and on the server
  // during a render.
  if (typeof navigator === "undefined") return
  if (!("serviceWorker" in navigator)) return
  const target = navigator.serviceWorker.controller
  if (target === null) return
  try {
    target.postMessage({ type: SW_MESSAGE, value })
  } catch {
    // Worker is gone or starting. The next assert on boot covers it.
  }
}

/**
 * Read the flag from storage and the URL, and assert it downward to the
 * service worker. Idempotent; call it once from the client boot.
 *
 * `?offline=1` sets the flag and `?offline=0` clears it, because on a phone
 * typing a query parameter is easier than reaching a settings screen in an app
 * that is pretending to be broken.
 */
export function hydrateForcedOffline(): void {
  if (typeof window === "undefined" || hydrated) return
  hydrated = true

  const param = new URLSearchParams(window.location.search).get("offline")
  if (param === "1" || param === "0") {
    forced = param === "1"
    writeStored(forced)
  } else {
    forced = readStored()
  }

  tellServiceWorker(forced)
  installConsoleBridge()
}

export function isForcedOffline(): boolean {
  return forced
}

export function setForcedOffline(value: boolean): void {
  if (forced === value) return
  forced = value
  writeStored(value)
  tellServiceWorker(value)
  for (const listener of listeners) listener(value)
}

export function subscribeForcedOffline(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Test seam — the flag is a module singleton like the bus and the queue. */
export function resetForcedOfflineForTests(): void {
  forced = false
  hydrated = false
  listeners.clear()
}

declare global {
  interface Window {
    __draftZero?: { offline: (value?: boolean) => boolean }
  }
}

function installConsoleBridge(): void {
  window.__draftZero = {
    offline(value?: boolean) {
      if (value !== undefined) setForcedOffline(value)
      return forced
    },
  }
}
