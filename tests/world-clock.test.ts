import { describe, expect, test } from "bun:test"
import { absoluteMinutes, clockTime, worldClockLabel } from "@/lib/world/clock"

describe("world clock controls", () => {
  test("matches all server bucket boundaries and day rollover", () => {
    for (const [minutes, label] of [
      [0, "Day 1 · night"],
      [359, "Day 1 · night"],
      [360, "Day 1 · morning"],
      [720, "Day 1 · afternoon"],
      [1080, "Day 1 · evening"],
      [1440, "Day 2 · night"],
      [3960, "Day 3 · evening"],
    ] as const)
      expect(worldClockLabel(minutes)).toBe(label)
  })
  test("sets absolute minutes without rounding away the time", () => {
    expect(absoluteMinutes(3, "18:07")).toBe(3967)
    expect(clockTime(3967)).toBe("18:07")
    for (const [day, time] of [
      [0, "18:00"],
      [1.5, "18:00"],
      [1, "24:00"],
      [1, "12:60"],
      [1, ""],
      [Infinity, "00:00"],
    ] as const)
      expect(absoluteMinutes(day, time)).toBeNull()
  })
})
