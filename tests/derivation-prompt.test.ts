// tests/derivation-prompt.test.ts — Pins the shape of the derivation turn.
//
// The paragraph split is the part worth a test: it is boundary arithmetic on a
// string, and every way it can be wrong is silent. Slice one character off and
// the moment to depict opens mid-word; take the FIRST break instead of the last
// and the picture illustrates a passage the writer scrolled past three moves
// ago. Nothing throws in either case — a prompt still streams into the composer
// and still reads like prose, which is exactly why nobody would catch it.

import { describe, expect, test } from "bun:test"

import type { ComposedContext } from "@/lib/generation/types"
import {
  DERIVATION_SYSTEM_PROMPT,
  renderDerivationPrompt,
} from "@/lib/images/derivation-prompt"

function contextOf(extra: Partial<ComposedContext> = {}): ComposedContext {
  return {
    systemPrompt: "",
    memory: "",
    lore: [],
    summary: "",
    storyText: "",
    authorsNote: "",
    seed: 0,
    approxTokens: 0,
    fit: {
      loreMatched: 0,
      loreStableMatched: 0,
      storyChars: 0,
      storyCharsKept: 0,
    },
    trim: { windowStart: 0, quantum: 1 },
    ...extra,
  }
}

describe("renderDerivationPrompt", () => {
  test("depicts the last paragraph, not the whole window", () => {
    const rendered = renderDerivationPrompt(
      contextOf({
        storyText: "First beat.\n\nSecond beat.\n\nThe arrived moment.",
      })
    )
    expect(rendered).toContain("The moment to depict:\nThe arrived moment.")
    expect(rendered).toContain(
      "Story so far, for context:\nFirst beat.\n\nSecond beat."
    )
  })

  test("a single-paragraph window is all moment and carries no context block", () => {
    const rendered = renderDerivationPrompt(
      contextOf({ storyText: "Only this." })
    )
    expect(rendered).toContain("The moment to depict:\nOnly this.")
    expect(rendered).not.toContain("Story so far")
  })

  test("a chevroned player turn is a legitimate final moment", () => {
    const rendered = renderDerivationPrompt(
      contextOf({ storyText: "The door waits.\n\n> You push it open." })
    )
    expect(rendered).toContain("The moment to depict:\n> You push it open.")
  })

  test("empty memory and lore contribute no labelled blocks", () => {
    const rendered = renderDerivationPrompt(
      contextOf({ memory: "   ", storyText: "A beat." })
    )
    expect(rendered).not.toContain("Setting notes")
    expect(rendered).not.toContain("Relevant details")
  })

  test("memory and lore ride along when present, lore trimmed", () => {
    const rendered = renderDerivationPrompt(
      contextOf({
        memory: "A drowned city.",
        lore: [
          {
            id: "l1",
            name: "Mira",
            content: "  the innkeeper, a widow in her fifties  ",
            priority: 0,
            matchedKey: "Mira",
            depth: 0,
            triggeredBy: null,
            stable: false,
          },
        ],
        storyText: "A beat.",
      })
    )
    expect(rendered).toContain("Setting notes:\nA drowned city.")
    expect(rendered).toContain(
      "Relevant details:\n- Mira: the innkeeper, a widow in her fifties"
    )
  })
})

describe("DERIVATION_SYSTEM_PROMPT", () => {
  // The chevron legend is load-bearing and easy to lose in an edit: the story
  // text arrives in the narrator's wire format, and this prompt is the only
  // place the derivation model is ever told what the marker means.
  test("explains the player-turn marker it will be sent", () => {
    expect(DERIVATION_SYSTEM_PROMPT).toContain('Lines beginning with "> "')
  })

  // The example is the format enforcement. If it ever stops looking like the
  // output we want, the prohibitions are all that is left holding the shape.
  test("carries a worked example whose prompt obeys its own rules", () => {
    const example = DERIVATION_SYSTEM_PROMPT.split("Example prompt:")[1]
    expect(example).toBeDefined()
    const words = example!.split("Reply with")[0]!.trim().split(/\s+/)
    expect(words.length).toBeGreaterThanOrEqual(50)
    expect(words.length).toBeLessThanOrEqual(90)
  })
})
