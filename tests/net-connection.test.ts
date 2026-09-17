// tests/net-connection.test.ts — the connection machine's decision rules.
//
// The window-event wiring in startConnectionWatch is not exercised here (bun
// has no window, and the guard makes it a no-op). What is exercised is every
// rule that decides the state: what counts as proof of online, what a probe
// failure is allowed to conclude, and that the debug flag beats all of it.

import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import {
  getConnectionState,
  probeConnection,
  reportRequestSuccess,
  resetConnectionForTests,
  subscribeConnection,
} from "@/lib/net/connection"
import { resetForcedOfflineForTests, setForcedOffline } from "@/lib/net/debug"

const realFetch = globalThis.fetch

/** Swap in a fetch, and report how many times it was actually called. */
function stubFetch(impl: () => Promise<Response>): { calls: () => number } {
  let calls = 0
  globalThis.fetch = (() => {
    calls++
    return impl()
  }) as unknown as typeof fetch
  return { calls: () => calls }
}

function ok(): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify({ ok: true })))
}

beforeEach(() => {
  resetConnectionForTests()
  resetForcedOfflineForTests()
})

afterEach(() => {
  globalThis.fetch = realFetch
  resetConnectionForTests()
  resetForcedOfflineForTests()
})

describe("probeConnection", () => {
  test("a 200 is proof of online", async () => {
    stubFetch(ok)
    const result = await probeConnection()
    expect(result.ok).toBe(true)
    expect(getConnectionState()).toBe("online")
  })

  test("an HTTP error means the server is broken, not unreachable", async () => {
    stubFetch(() => Promise.resolve(new Response("nope", { status: 503 })))
    const result = await probeConnection()

    expect(result).toEqual({ ok: false, reason: "server-error", status: 503 })
    expect(getConnectionState()).toBe("offline")
  })

  test("a thrown fetch is unreachable", async () => {
    stubFetch(() => Promise.reject(new TypeError("Failed to fetch")))
    const result = await probeConnection()

    expect(result).toEqual({ ok: false, reason: "unreachable" })
    expect(getConnectionState()).toBe("offline")
  })

  test("concurrent callers share one request", async () => {
    const gate = Promise.withResolvers<void>()
    const stub = stubFetch(async () => {
      await gate.promise
      return new Response("{}")
    })

    const both = Promise.all([probeConnection(), probeConnection()])
    gate.resolve()
    await both

    // The panel's Test button pressed mid-ladder must not open a second socket.
    expect(stub.calls()).toBe(1)
  })
})

describe("forced offline", () => {
  test("short-circuits the probe without touching the network", async () => {
    const stub = stubFetch(ok)
    setForcedOffline(true)

    const result = await probeConnection()

    expect(result).toEqual({ ok: false, reason: "forced" })
    expect(getConnectionState()).toBe("offline")
    expect(stub.calls()).toBe(0)
  })

  test("beats a server that is answering perfectly well", async () => {
    stubFetch(ok)
    await probeConnection()
    expect(getConnectionState()).toBe("online")

    setForcedOffline(true)
    await probeConnection()
    expect(getConnectionState()).toBe("offline")
  })

  test("a probe already in flight cannot undo a flag flipped mid-flight", async () => {
    // Get to a known offline state via the ordinary failure path first, so a
    // wrongly-applied success is observable: the bug this guards against
    // would flip this back to "online" underneath the flag.
    stubFetch(() => Promise.reject(new TypeError("Failed to fetch")))
    await probeConnection()
    expect(getConnectionState()).toBe("offline")

    // The race: rawProbe() only checks the flag at its own start, and a
    // fetch can take up to PROBE_TIMEOUT_MS. If the flag is set AFTER that
    // check but the fetch still resolves ok, letting the success declare
    // online would silently reverse the offline state the flag represents.
    const gate = Promise.withResolvers<void>()
    stubFetch(async () => {
      await gate.promise
      return new Response("{}")
    })

    const pending = probeConnection()
    setForcedOffline(true)

    gate.resolve()
    const result = await pending

    // The network genuinely answered — that fact is not what the flag
    // overrides — but the state machine must not act on it.
    expect(result.ok).toBe(true)
    expect(getConnectionState()).toBe("offline")
  })
})

describe("reportRequestSuccess", () => {
  test("a successful write is enough to declare online again", async () => {
    stubFetch(() => Promise.reject(new TypeError("Failed to fetch")))
    await probeConnection()
    expect(getConnectionState()).toBe("offline")

    reportRequestSuccess()
    expect(getConnectionState()).toBe("online")
  })

  test("cannot override the debug flag", async () => {
    setForcedOffline(true)
    await probeConnection()

    reportRequestSuccess()

    expect(getConnectionState()).toBe("offline")
  })
})

describe("subscribers", () => {
  test("are notified on change and never for a repeat of the same state", async () => {
    const seen: string[] = []
    subscribeConnection((state) => seen.push(state))

    stubFetch(() => Promise.reject(new TypeError("Failed to fetch")))
    await probeConnection()
    await probeConnection()

    globalThis.fetch = (() => ok()) as unknown as typeof fetch
    await probeConnection()

    expect(seen).toEqual(["offline", "online"])
  })

  test("unsubscribe stops delivery", async () => {
    const seen: string[] = []
    const off = subscribeConnection((state) => seen.push(state))
    off()

    stubFetch(() => Promise.reject(new TypeError("Failed to fetch")))
    await probeConnection()

    expect(seen).toEqual([])
  })
})
