/*
 * Service worker — the only reason an installed copy can open without a
 * network. Everything else offline (the cached stories, the held writes, the
 * banner) is ordinary app code that simply never got a chance to run: without
 * this file the document request fails and iOS shows its own error page before
 * a single line of draft zero executes.
 *
 * Deliberately hand-written and dependency-free. The caching this app needs is
 * three rules long, and a generated worker would be a build step and a
 * dependency in exchange for rules nobody here would read.
 *
 * The three rules:
 *
 *   Navigations   network first, falling back to the last good copy of that
 *                 same URL, then to the last good copy of "/", then to a
 *                 built-in page. Documents are dynamic (the root layout is
 *                 force-dynamic), so there is no static shell to precache;
 *                 the cache is filled deliberately by warm(), because fetch
 *                 events alone never see most of the pages you visit.
 *   /_next/static network first, falling back to the cache. NOT cache
 *                 first — see handleStatic; this file asserted the opposite
 *                 and was wrong, in a way that only shows up after a deploy.
 *   Everything    network only. API routes, server actions and RSC payloads
 *   else          are never served stale; a wrong answer there is worse than
 *                 no answer, and the client store already holds the data.
 *
 * VERSION is the cache epoch. Bumping it drops every prior cache on activate,
 * which is what keeps a stale document from outliving the chunks it imports.
 */

const VERSION = "v1"
const DOC_CACHE = `dz-doc-${VERSION}`
const STATIC_CACHE = `dz-static-${VERSION}`

/** Documents kept, most-recent-first. Enough for a deep library, small on disk. */
const MAX_DOCUMENTS = 40

/**
 * Debug switch, set from the app over postMessage. When true every request
 * this worker handles fails as though the radio were off — including
 * navigations, which is the part an in-page flag cannot fake. See
 * lib/net/debug.ts.
 *
 * Deliberately not persisted here: a worker restarting into forced-offline
 * with no page to turn it off would be a brick. The app re-asserts it on every
 * page load instead.
 */
let forcedOffline = false

self.addEventListener("message", (event) => {
  const data = event.data
  if (data === null || typeof data !== "object") return
  if (data.type === "dz-force-offline") {
    forcedOffline = data.value === true
  }
  if (data.type === "dz-skip-waiting") {
    self.skipWaiting()
  }
  // The app telling us which document it is currently showing. See warm().
  if (data.type === "dz-warm" && typeof data.url === "string") {
    event.waitUntil(warm(data.url))
  }
})

/**
 * Fetch a document and put it in the cache, because nothing else will.
 *
 * Two holes make this necessary, and between them they meant a user could
 * browse the whole app and end up with an empty document cache:
 *
 *   The FIRST load of a page is not controlled by this worker — the worker is
 *   still installing — so its fetch event never reaches here. A one-visit
 *   device therefore cached nothing, which is exactly the device most likely
 *   to be offline next.
 *   Client-side route changes issue no navigation request at all. Opening a
 *   story from the library is an RSC fetch, so the story's document was never
 *   seen here even on a controlled page.
 *
 * So the app asks, on every settled route, while online.
 */
async function warm(url) {
  try {
    const request = new Request(url, { credentials: "same-origin" })
    const response = await fetch(request)
    if (response.ok) await rememberDocument(request, response)
  } catch {
    // Offline, or the route is gone. Either way there is nothing to store.
  }
}

self.addEventListener("install", (event) => {
  // "/" is the one document worth having unconditionally: it renders the whole
  // library out of IndexedDB, so it is a useful landing place for any story
  // this device has never opened. Everything else arrives through warm().
  event.waitUntil(
    caches
      .open(DOC_CACHE)
      .then((cache) => cache.add("/"))
      .catch(() => {
        // Installing offline is allowed to produce a worker with an empty
        // cache. It is still better than no worker.
      })
  )
  // Taking over immediately is safe because a stale worker serving a new build
  // is exactly what VERSION guards.
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([DOC_CACHE, STATIC_CACHE])
      const names = await caches.keys()
      await Promise.all(
        names.map((name) =>
          name.startsWith("dz-") && !keep.has(name)
            ? caches.delete(name)
            : undefined
        )
      )
      await self.clients.claim()
    })()
  )
})

self.addEventListener("fetch", (event) => {
  const request = event.request

  // Server actions are POSTs to a page URL and must never be replayed from a
  // cache, so method is the first gate rather than a special case later.
  if (request.method !== "GET") return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(event, request))
    return
  }

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(handleStatic(event, request))
    return
  }

  // Everything else — API routes, RSC payloads, images — goes to the network
  // untouched. A failed RSC fetch makes the Next router fall back to a hard
  // navigation, which arrives here as a navigate request and is served from
  // the document cache. That fallback is why offline route changes work at all.
})

async function handleNavigation(event, request) {
  if (!forcedOffline) {
    try {
      const fresh = await fetch(request)
      // Only 200s. A cached 404 or 500 would outlive the condition that caused
      // it and there is no way for the user to tell why.
      //
      // waitUntil, not a bare promise: respondWith settles the moment the
      // response is handed back, and a worker with no outstanding work can be
      // killed immediately after. Unheld, this write loses the race often
      // enough that a page can be visited repeatedly and never get cached —
      // which fails in the one place nobody tests, the first time you are
      // actually offline.
      if (fresh.ok) {
        event.waitUntil(rememberDocument(request, fresh.clone()))
      }
      return fresh
    } catch {
      // fall through to the cache
    }
  }

  const cache = await caches.open(DOC_CACHE)

  // ignoreSearch because a story URL's query string carries view state, not
  // identity: ?tab=lore should still open offline off the copy saved without it.
  const exact = await cache.match(request, { ignoreSearch: true })
  if (exact !== undefined) return exact

  // The library renders the whole store from IndexedDB, so it is a useful
  // landing place for a story never visited on this device.
  const root = await cache.match("/", { ignoreSearch: true })
  if (root !== undefined) return root

  return offlineFallback()
}

/**
 * Build assets: network first, cache only as the offline fallback.
 *
 * This was cache-first, on the assumption that a hashed path can only ever
 * hold one build's bytes. That assumption is false here — Turbopack reuses
 * chunk paths between builds, so the same URL served different JavaScript
 * after a deploy and a cache-first worker pinned the browser to the old copy
 * indefinitely. The symptom is the worst kind: a fresh document hydrating
 * against stale code, on returning visitors only, long after the deploy.
 *
 * Network-first costs almost nothing here. Next serves these immutable with a
 * year-long max-age, and a fetch from inside a worker goes through the HTTP
 * cache, so the "network" request for an unchanged asset is answered locally
 * without touching the wire.
 */
async function handleStatic(event, request) {
  const cache = await caches.open(STATIC_CACHE)

  if (!forcedOffline) {
    try {
      const fresh = await fetch(request)
      if (fresh.ok) {
        // Held for the same reason the document write is: a chunk that never
        // made it into the cache is a cached document that cannot boot.
        event.waitUntil(cache.put(request, fresh.clone()))
        return fresh
      }
    } catch {
      // fall through to the cache
    }
  }

  const hit = await cache.match(request)
  return hit ?? Response.error()
}

/**
 * Store the document and trim the cache back to MAX_DOCUMENTS.
 *
 * Insertion order is the eviction order: the Cache API returns keys oldest
 * first, and re-visiting a URL deletes before it puts, so a page you keep
 * opening keeps moving to the back of the queue rather than ageing out.
 */
async function rememberDocument(request, response) {
  try {
    const cache = await caches.open(DOC_CACHE)
    await cache.delete(request, { ignoreSearch: true })
    await cache.put(request, response)

    const keys = await cache.keys()
    const excess = keys.length - MAX_DOCUMENTS
    for (let i = 0; i < excess; i++) {
      await cache.delete(keys[i])
    }
  } catch {
    // A cache is an optimisation. A failed write costs one network request.
  }
}

/**
 * The last resort: offline, and this device has never loaded the app. There is
 * nothing in IndexedDB either, so there is no story to show and nothing to do
 * but say so honestly and offer the retry.
 */
function offlineFallback() {
  const body = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Offline · draft zero</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0; min-height: 100dvh;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 1rem; padding: 2rem; text-align: center;
    font: 16px/1.6 -apple-system, system-ui, sans-serif;
    background: #ffffff; color: #0a0a0a;
  }
  @media (prefers-color-scheme: dark) { body { background: #0a0a0a; color: #fafafa; } }
  h1 { font-size: 1.125rem; font-weight: 600; margin: 0; }
  p { margin: 0; max-width: 28rem; opacity: .7; font-size: .9375rem; }
  button {
    font: inherit; font-size: .875rem; padding: .5rem 1rem; margin-top: .5rem;
    border-radius: 999px; border: 1px solid currentColor; background: none;
    color: inherit; cursor: pointer;
  }
</style>
</head>
<body>
  <h1>You are offline</h1>
  <p>draft zero has nothing saved on this device yet, so there is nothing to show until you are back on a network.</p>
  <button onclick="location.reload()">Try again</button>
</body>
</html>`

  return new Response(body, {
    status: 503,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  })
}
