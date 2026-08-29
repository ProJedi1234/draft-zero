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
  renderBriefDerivationPrompt,
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
      "Recent passages, for context:\nFirst beat.\n\nSecond beat."
    )
  })

  test("a single-paragraph window is all moment and carries no context block", () => {
    const rendered = renderDerivationPrompt(
      contextOf({ storyText: "Only this." })
    )
    expect(rendered).toContain("The moment to depict:\nOnly this.")
    expect(rendered).not.toContain("Recent passages")
  })

  // The summary is where a character introduced far outside the manuscript
  // window still has a face — dropping it silently is the continuity bug this
  // block exists to pin.
  test("the rolling summary rides along under its own label", () => {
    const rendered = renderDerivationPrompt(
      contextOf({ summary: "Long ago, a city drowned.", storyText: "A beat." })
    )
    expect(rendered).toContain(
      "The story so far, summarized:\nLong ago, a city drowned."
    )
  })

  test("an empty summary contributes no labelled block", () => {
    const rendered = renderDerivationPrompt(
      contextOf({ summary: "  ", storyText: "A beat." })
    )
    expect(rendered).not.toContain("summarized")
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

  // The examples are the format enforcement. If they ever stop looking like
  // the output we want, the prohibitions are all that is left holding the
  // shape — and if they collapse back to one, every derivation imitates it.
  test("carries several worked examples, each inside the elastic length band", () => {
    const examples = DERIVATION_SYSTEM_PROMPT.split("Example prompt:")
      .slice(1)
      .map((chunk) => chunk.split(/Example story:|Reply with/)[0]!.trim())
    expect(examples.length).toBeGreaterThanOrEqual(3)
    for (const example of examples) {
      const words = example.split(/\s+/)
      expect(words.length).toBeGreaterThanOrEqual(25)
      expect(words.length).toBeLessThanOrEqual(90)
    }
  })

  // One example must demonstrate lore-as-canon: appearance details arriving in
  // a "Relevant details:" block and reappearing in the prompt, not re-imagined.
  test("one example shows lore appearance details carried into the prompt", () => {
    expect(DERIVATION_SYSTEM_PROMPT).toContain("Relevant details:")
    expect(DERIVATION_SYSTEM_PROMPT).toContain("soot-streaked leather apron")
  })
})

/**
 * Brief mode's turn. The sections are conditional in the same way the story
 * window's are, and the failure is the same shape: a block that silently does
 * not render costs the model the one detail that would have kept a character's
 * face the same, and nothing throws.
 *
 * The exclusion case is the one that is genuinely new. A muted chip is a
 * promise the writer can see — that entry is not going into this call — and
 * the only place it can be broken is here, where absence looks exactly like an
 * entry that never matched.
 */
describe("renderBriefDerivationPrompt", () => {
  const lore = [
    { name: "Lara", content: "A tomb raider — dark braid, torn jacket." },
  ]

  test("carries the brief under a label that names it as the request", () => {
    const rendered = renderBriefDerivationPrompt({
      brief: "Lara at the tomb door, torch raised",
      memory: "",
      lore: [],
      summary: "",
    })
    expect(rendered).toContain(
      "The writer's request:\nLara at the tomb door, torch raised"
    )
  })

  test("renders memory, lore and summary when they exist", () => {
    const rendered = renderBriefDerivationPrompt({
      brief: "Lara at the door",
      memory: "The year is 1938.",
      lore,
      summary: "She has been searching for the tomb for six weeks.",
    })
    expect(rendered).toContain("Setting notes:\nThe year is 1938.")
    expect(rendered).toContain(
      "Relevant details:\n- Lara: A tomb raider — dark braid, torn jacket."
    )
    expect(rendered).toContain("The story so far, summarized:\nShe has been")
  })

  test("omits the blocks it has nothing for", () => {
    const rendered = renderBriefDerivationPrompt({
      brief: "a coin on a counter",
      memory: "   ",
      lore: [],
      summary: "",
    })
    expect(rendered).not.toContain("Setting notes")
    expect(rendered).not.toContain("Relevant details")
    expect(rendered).not.toContain("summarized")
  })

  test("an excluded entry is simply not there — the caller filters, we render", () => {
    const rendered = renderBriefDerivationPrompt({
      brief: "Lara and Sefa at the door",
      memory: "",
      // What the route hands over once the muted chip has been dropped.
      lore,
      summary: "",
    })
    expect(rendered).toContain("- Lara:")
    // The brief still says the name — that is the writer's sentence, and it is
    // sent verbatim. What must be gone is the muted entry's DETAILS.
    expect(rendered).toContain("Sefa")
    expect(rendered).not.toContain("- Sefa:")
  })

  test("never sends the recent manuscript — that is the whole inversion", () => {
    const rendered = renderBriefDerivationPrompt({
      brief: "Lara at the door",
      memory: "",
      lore: [],
      summary: "",
    })
    expect(rendered).not.toContain("Recent passages")
    expect(rendered).not.toContain("The moment to depict")
  })
})
