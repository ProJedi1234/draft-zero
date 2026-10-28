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
import { MOCK_STORIES } from "@/lib/mock-data"
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
      features: { world: { enabled: true, pacing: "" } },
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
      npc: false,
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

    const context = composeContext({ story, lorebookEntries: [lore] })
    const prompt = renderPrompt(context)
    const labels = [...prompt.matchAll(/^\[([^\]:]+)/gm)].map((m) => m[1])

    expect(new Set(labels)).toEqual(
      new Set([
        "Memory",
        "Lore",
        "Story so far",
        "Story",
        "World",
        "Author's note",
      ])
    )
    for (const label of labels) {
      expect(context.systemPrompt).toContain(`[${label}`)
    }
  })

  test("covers a Continue, where the excerpt ends with narration", () => {
    // A plain Continue appends no turn. Telling the model the excerpt always
    // ends with a `>` line asks it to retell the last paragraph.
    expect(NARRATOR_MECHANICS).toContain("ends with narration")
    expect(NARRATOR_MECHANICS).not.toContain("the excerpt ends with one.")
  })
})

// Captured from feat/living-world before the server implementation.
const BASE_SYSTEM_PROMPT =
  "you are the narrator of an interactive adventure. the player plays the main character, written as \"you\"; you play the world and everyone else in it. continue the story like it never stopped, in the voice it already has. follow these rules:\n- present tense, second person\n- keep the reader inside the main character: what you see, hear and touch, up close\n- concrete, specific detail over summary and abstraction\n- when a character enters a scene, give them one memorable detail\n- convey emotion through sentence rhythm and what the narration notices, not by naming it\n- let the world push back: people want things of their own, plans meet resistance, not every attempt succeeds\n- dialogue sounds like the person speaking it — their background, mood and mannerisms. break grammar when they would\n- keep it fresh: do not reuse phrasing, images or sentence shapes from recent passages\n\nhow the story reaches you:\n- the user turn is the story so far, in labelled blocks. [Memory] and [Lore: …] are facts about the world. [Story so far] sums up what came before the excerpt. [Story] is the excerpt itself — its final paragraph may come after a [Lore: …] or [Author's note: …] block. the author's note is direction for the passage you are about to write: follow it, never mention it. none of these labels belong in your prose\n- lines beginning with > are the player's own turns, not narration. when the excerpt ends with one, carry it into your prose as it happens — narrate the action, and put their speech in quotes in the story — then continue into what it causes. when it ends with narration instead, pick up exactly where it stops, without retelling it\n- never write a > line yourself, and never take a further turn for the player. write only the prose that follows, with no > and no leading marker of any kind\n- unless the instructions above set a different length, write ONE paragraph, roughly 40 to 100 words. a second only if a distinct beat demands it, never a third. stop while the scene still has somewhere to go"

test("disabled stories preserve the base system prompt byte for byte", () => {
  for (const features of [{}, { world: { enabled: false, pacing: "" } }]) {
    const story = { ...MOCK_STORIES[0], systemPrompt: null, features }
    const context = composeContext({ story, lorebookEntries: [] })
    expect(context.systemPrompt).toBe(BASE_SYSTEM_PROMPT)
    expect(
      context.systemPrompt.match(/how the story reaches you:/g)
    ).toHaveLength(1)
  }
  expect(resolveSystemPrompt("Be terse.")).toBe(
    "Be terse.\n\n" +
      BASE_SYSTEM_PROMPT.slice(
        BASE_SYSTEM_PROMPT.indexOf("how the story reaches you:")
      )
  )
})

test("enabled stories append one lowercase world mechanics bullet after resolving once", () => {
  const prompt = composeContext({
    story: {
      ...MOCK_STORIES[0],
      systemPrompt: "Be terse.",
      features: { world: { enabled: true, pacing: "" } },
    },
    lorebookEntries: [],
  }).systemPrompt
  expect(
    prompt.startsWith(resolveSystemPrompt("Be terse.") + "\n- [World: ")
  ).toBe(true)
  expect(prompt).toContain(
    "keep each NPC's knowledge limited to their own experience"
  )
  expect(prompt.match(/how the story reaches you:/g)).toHaveLength(1)
})
