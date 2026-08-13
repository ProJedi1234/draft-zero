// tests/id.test.ts — Pins randomId's behaviour in the environment that actually
// broke: a page served over plain HTTP to a LAN address, where the browser
// withholds crypto.randomUUID because the context is not secure.
//
// The interesting case is the fallback, and it cannot be reached by running the
// tests normally — bun, like Node, always provides randomUUID. So the suite
// deletes it for the duration, which is precisely what an insecure context does.

import { afterEach, describe, expect, test } from "bun:test"

import { randomId } from "@/lib/id"

/** RFC 4122 v4: version nibble is 4, variant nibble is one of 8, 9, a, b. */
const V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

const original = crypto.randomUUID

/** Restores the real implementation even if an expectation threw. */
afterEach(() => {
  Object.defineProperty(crypto, "randomUUID", {
    value: original,
    configurable: true,
    writable: true,
  })
})

/** Removes randomUUID the way a non-secure context does: the property is gone. */
function withoutRandomUUID(run: () => void) {
  Object.defineProperty(crypto, "randomUUID", {
    value: undefined,
    configurable: true,
    writable: true,
  })
  run()
}

describe("randomId", () => {
  test("returns a v4 UUID when crypto.randomUUID is available", () => {
    expect(randomId()).toMatch(V4)
  })

  test("still returns a v4 UUID when randomUUID is missing", () => {
    withoutRandomUUID(() => {
      expect(randomId()).toMatch(V4)
    })
  })

  test("does not throw when randomUUID is missing", () => {
    withoutRandomUUID(() => {
      // The regression itself: this call site threw "crypto.randomUUID is not a
      // function" on every Send and Continue over http://<lan-ip>.
      expect(() => randomId()).not.toThrow()
    })
  })

  test("the fallback does not repeat itself", () => {
    withoutRandomUUID(() => {
      const ids = new Set(Array.from({ length: 1000 }, () => randomId()))
      expect(ids.size).toBe(1000)
    })
  })
})
