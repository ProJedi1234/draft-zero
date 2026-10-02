// tests/system-prompt.test.ts — Pins the split between the narrator prompt a
// story may override and the mechanics it may not.
//
// Both failures this guards against are silent. An override that drops the
// mechanics still generates — the model just stops recognising `>` turns,
// which an AI Dungeon import fills its whole manuscript with. And a block label
// added to renderPrompt without a line in the mechanics is a bracket format the
// model was never told about, which is exactly what an instruct model reads as
// a document to format.

import { describe, expect, test } from "bun:test"

import { composeContext, renderPrompt } from "@/lib/generation/context"
import {
  DEFAULT_NARRATOR_PROMPT,
  DEFAULT_SYSTEM_PROMPT,
  NARRATOR_MECHANICS,
  resolveSystemPrompt,
} from "@/lib/generation/system-prompt"
import type { LorebookEntry, Story } from "@/lib/types"

describe("resolveSystemPrompt", () => {
  test("no override sends the default narrator, then the mechanics", () => {
    const prompt = resolveSystemPrompt(null)

    expect(prompt).toBe(DEFAULT_SYSTEM_PROMPT)
    expect(prompt.startsWith(DEFAULT_NARRATOR_PROMPT)).toBe(true)
    expect(prompt.endsWith(NARRATOR_MECHANICS)).toBe(true)
  })

  test("an override replaces the narrator and keeps the mechanics", () => {
    const prompt = resolveSystemPrompt("Never break the fourth wall.")

    expect(prompt).toBe(`Never break the fourth wall.\n\n${NARRATOR_MECHANICS}`)
    expect(prompt).not.toContain(DEFAULT_NARRATOR_PROMPT)
  })

  test("a blank override falls back to the default narrator", () => {
    expect(resolveSystemPrompt("   \n ")).toBe(DEFAULT_SYSTEM_PROMPT)
    expect(resolveSystemPrompt("")).toBe(DEFAULT_SYSTEM_PROMPT)
  })

  test("the mechanics are sent exactly once", () => {
    const prompt = resolveSystemPrompt("Be terse.")
    expect(prompt.split(NARRATOR_MECHANICS)).toHaveLength(2)
  })
})

describe("NARRATOR_MECHANICS", () => {
  test("names every block label the user turn can carry", () => {
    // Every optional block switched on at once, so the rendered prompt shows
    // each label renderPrompt knows how to emit.
    const story = {
      id: "story",
      title: "Untitled Story",
      memory: "You are a smuggler.",
      authorsNote: "Keep it tense.",
      summary: "You fled the port at dawn.",
      summarize: true,
      systemPrompt: null,
      settings: { contextWindow: 8000, loreBudget: 50 },
      entries: [
        { text: "The hold creaks.", kind: null },
        { text: "You check the cargo.", kind: "do" },
      ].map((entry, position) => ({
        id: `e${position}`,
        position,
        text: entry.text,
        actionKind: entry.kind,
        inputText: entry.kind === null ? null : "typed",
        source: entry.kind === null ? "generated" : "user",
      })),
    } as unknown as Story
    const lore: LorebookEntry = {
      id: "lore-1",
      storyId: "story",
      name: "The Gull",
      category: "item",
      keys: [],
      content: "Your ship.",
      enabled: true,
      alwaysActive: true,
      priority: 50,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }

    const prompt = renderPrompt(
      composeContext({ story, lorebookEntries: [lore] })
    )
    const labels = [...prompt.matchAll(/^\[([^\]:]+)/gm)].map((m) => m[1])

    expect(new Set(labels)).toEqual(
      new Set(["Memory", "Lore", "Story so far", "Story", "Author's note"])
    )
    for (const label of labels) {
      expect(NARRATOR_MECHANICS).toContain(`[${label}`)
    }
  })

  test("covers a Continue, where the excerpt ends with narration", () => {
    // A plain Continue appends no turn. Telling the model the excerpt always
    // ends with a `>` line asks it to retell the last paragraph.
    expect(NARRATOR_MECHANICS).toContain("ends with narration")
    expect(NARRATOR_MECHANICS).not.toContain("the excerpt ends with one.")
  })
})
