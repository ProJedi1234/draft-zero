// tests/image-style.test.ts — Joining a scene to its style, and taking it back
// apart.
//
// Both halves are one-liners with regexes in them, which is exactly the shape
// that fails quietly: a style appended twice reads as a slightly odd prompt
// rather than a bug, and a split that eats one character too many silently
// deletes the end of a writer's sentence on the way back into the composer.

import { describe, expect, test } from "bun:test"

import {
  composeSentPrompt,
  splitSentPrompt,
  IMAGE_STYLE_PRESETS,
} from "@/lib/images/styles"

describe("composeSentPrompt", () => {
  test("appends the style as a trailing sentence", () => {
    expect(composeSentPrompt("A lit chapel doorway.", "oil painting")).toBe(
      "A lit chapel doorway. Style: oil painting."
    )
  })

  test("no style is no suffix at all", () => {
    expect(composeSentPrompt("A lit chapel doorway.", null)).toBe(
      "A lit chapel doorway."
    )
    expect(composeSentPrompt("A lit chapel doorway.", "   ")).toBe(
      "A lit chapel doorway."
    )
  })

  test("does not double the full stop a style already ends with", () => {
    expect(composeSentPrompt("A door.", "ink sketch.")).toBe(
      "A door. Style: ink sketch."
    )
  })

  test("trims both halves rather than trusting the field", () => {
    expect(composeSentPrompt("  A door.\n", "  noir  ")).toBe(
      "A door. Style: noir."
    )
  })
})

describe("splitSentPrompt", () => {
  test("round-trips every shipped preset", () => {
    // The pairing that actually matters: whatever compose puts on, split has to
    // take off, or a picture handed back to the composer redraws double-styled.
    for (const preset of IMAGE_STYLE_PRESETS) {
      const sent = composeSentPrompt("A door in the rain.", preset.text)
      expect(splitSentPrompt(sent)).toEqual({
        scene: "A door in the rain.",
        style: preset.text,
      })
    }
  })

  test("leaves a prompt with no style clause alone", () => {
    expect(splitSentPrompt("A door in the rain.")).toEqual({
      scene: "A door in the rain.",
      style: null,
    })
  })

  test("only a FINAL clause counts — a mid-prompt mention is scene text", () => {
    const prompt = "A poster reading Style: yours. Two figures beneath it"
    expect(splitSentPrompt(prompt).scene).toBe(prompt)
  })
})
