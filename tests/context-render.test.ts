// tests/context-render.test.ts — Pins the one thing about the rendered prompt
// that the system prompt now depends on structurally: player turns arrive
// chevroned, generated prose does not.
//
// Worth a test of its own because the failure is silent. Drop the marker and
// nothing throws, nothing looks wrong in the UI, and the story still generates
// — the model just loses track of which paragraph is the player's move and
// starts narrating past it. That was diagnosed once from a screenshot already;
// this is the cheaper way to catch it the second time.

import { describe, expect, test } from "bun:test"

import { composeContext, renderPrompt } from "@/lib/generation/context"
import type { LorebookEntry, Story } from "@/lib/types"

function storyOf(
  entries: { text: string; kind: "do" | "say" | null }[],
  extra: Partial<Story> = {}
): Story {
  return {
    id: "story",
    title: "Untitled Story",
    memory: "",
    authorsNote: "",
    summary: "",
    systemPrompt: null,
    settings: { contextWindow: 8000 },
    entries: entries.map((entry, position) => ({
      id: `e${position}`,
      position,
      text: entry.text,
      actionKind: entry.kind,
      inputText: entry.kind === null ? null : "typed",
      source: entry.kind === null ? "generated" : "user",
    })),
    ...extra,
  } as unknown as Story
}

function render(story: Story, lore: LorebookEntry[] = []): string {
  return renderPrompt(composeContext({ story, lorebookEntries: lore }))
}

describe("renderPrompt — player turn markers", () => {
  test("marks a Do turn and leaves generated prose alone", () => {
    const prompt = render(
      storyOf([
        { text: "You open the grate.", kind: "do" },
        { text: "The hinges give with a shriek.", kind: null },
      ])
    )

    expect(prompt).toContain("> You open the grate.")
    expect(prompt).toContain("\nThe hinges give with a shriek.")
    expect(prompt).not.toContain("> The hinges")
  })

  test("marks a Say turn, quotes intact", () => {
    const prompt = render(
      storyOf([{ text: 'You say, "Who\'s out there?"', kind: "say" }])
    )

    expect(prompt).toContain('> You say, "Who\'s out there?"')
  })

  test("marks every turn, not only the last", () => {
    const prompt = render(
      storyOf([
        { text: "You look around.", kind: "do" },
        { text: "Bare branches, no birds.", kind: null },
        { text: "You kick a rock.", kind: "do" },
        { text: "It vanishes into a hollow.", kind: null },
        { text: 'You say, "Hello?"', kind: "say" },
      ])
    )

    // The alternating column is the convention the model reads off the page;
    // one lone chevron on the final turn is a character it has to interpret.
    expect(prompt.match(/^> /gm)?.length).toBe(3)
  })

  // The regression that started this: with no memory and no author's note the
  // turn is the last paragraph of an undifferentiated [Story] block, and every
  // line in it opens with "You" — narration included.
  test("marks the final turn on a story with no memory and no author's note", () => {
    const prompt = render(
      storyOf([
        { text: "You look around at the blank forest.", kind: "do" },
        { text: "The trees stand like skeletal sentinels.", kind: null },
        { text: 'You say, "Who\'s out there?"', kind: "say" },
      ])
    )

    expect(prompt.trimEnd().endsWith('> You say, "Who\'s out there?"')).toBe(
      true
    )
  })

  test("keeps the marker when an author's note splits off the final turn", () => {
    const prompt = render(
      storyOf(
        [
          { text: "You look around.", kind: "do" },
          { text: "Bare branches, no birds.", kind: null },
          { text: 'You say, "Hello?"', kind: "say" },
        ],
        { authorsNote: "Keep the dread rising." }
      )
    )

    expect(prompt).toContain("[Author's note: Keep the dread rising.]")
    expect(prompt.trimEnd().endsWith('> You say, "Hello?"')).toBe(true)
  })
})
