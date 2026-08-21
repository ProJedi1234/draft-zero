import { describe, expect, test } from "bun:test"
import { formatElapsed } from "@/lib/format"

describe("formatElapsed", () => {
  const start = "2026-08-21T12:00:00Z"
  const at = (s: number) => formatElapsed(start, Date.parse(start) + s * 1000)

  test("seconds, then minutes, then hours", () => {
    expect(at(0)).toBe("0s")
    expect(at(9)).toBe("9s")
    expect(at(59)).toBe("59s")
    expect(at(60)).toBe("1m 00s")
    expect(at(74)).toBe("1m 14s")
    expect(at(3599)).toBe("59m 59s")
    expect(at(3600)).toBe("1h 0m")
    expect(at(3720)).toBe("1h 2m")
  })

  test("a device whose clock runs behind the server's counts from zero, never down", () => {
    expect(at(-30)).toBe("0s")
  })
})
