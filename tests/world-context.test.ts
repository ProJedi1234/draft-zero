import { expect, test } from "bun:test"
import { MOCK_STORIES, MOCK_LOREBOOK_ENTRIES } from "@/lib/mock-data"
import {
  composeContext,
  promptBlocks,
  promptSegments,
  renderPrompt,
} from "@/lib/generation/context"
import { describeContext } from "@/lib/generation/breakdown"
import { worldContext, worldTime } from "@/lib/world/context"
import type { WorldState } from "@/lib/services/world.schema"
const lore = Array.from({ length: 5 }, (_, i) => ({
  ...MOCK_LOREBOOK_ENTRIES[0],
  id: `npc-${i}`,
  name: `NPC ${i}`,
  npc: true,
  category: "character" as const,
  enabled: true,
  alwaysActive: true,
  priority: i,
}))
const state: WorldState = {
  storyId: "s",
  minutes: 2 * 1440 + 18 * 60,
  npcs: lore.map((e) => ({
    loreEntryId: e.id,
    name: e.name,
    mind: "I want the bell.",
    memories: Array.from({ length: 9 }, (_, i) => ({
      id: `m-${i}`,
      text: `I saw event ${i}.`,
      importance: i === 0 ? 5 : 2,
      minutes: i * 1440,
      entryId: "p",
    })),
  })),
}
test("clock buckets and day numbers", () => {
  expect([0, 360, 720, 1080, 1440].map(worldTime)).toEqual([
    "day 1, night",
    "day 1, morning",
    "day 1, afternoon",
    "day 1, evening",
    "day 2, night",
  ])
})
test("four NPCs by priority; six memories by importance and recency, printed in insertion order", () => {
  const blocks = worldContext(state, lore)
  expect(blocks).toHaveLength(5)
  expect(blocks[0]).toBe("[World: day 3, evening]")
  expect(blocks[1]).toStartWith("[NPC 4, now]")
  expect(blocks.join("\n")).not.toContain("[NPC 0, now]")
  expect(blocks[1].match(/I saw event \d/g)).toEqual([
    "I saw event 0",
    "I saw event 4",
    "I saw event 5",
    "I saw event 6",
    "I saw event 7",
    "I saw event 8",
  ])
})
test("world is volatile after lore and before the note; breakdown includes it and budget counts it", () => {
  const story = {
    ...MOCK_STORIES[0],
    features: { world: { enabled: true, pacing: "" } },
    world: state,
    authorsNote: "Stay quiet.",
  }
  const ctx = composeContext({ story, lorebookEntries: lore })
  const blocks = promptBlocks(ctx)
  const wi = blocks.findIndex((b) => b.section === "world")
  expect(wi).toBeGreaterThan(blocks.findIndex((b) => b.section === "story"))
  expect(wi).toBeLessThan(blocks.findIndex((b) => b.section === "authorsNote"))
  expect(
    promptSegments(ctx)
      .filter((s) => s.cache)
      .map((s) => s.text)
      .join("")
  ).not.toContain("[World:")
  expect(
    promptSegments(ctx).find((s) => s.text.includes("[World:"))?.cache
  ).toBe(false)
  expect(
    describeContext(ctx, 8192).sections.find((s) => s.id === "world")?.text
  ).toContain("[NPC 4, now]")
  expect(ctx.approxTokens).toBeLessThanOrEqual(story.settings.contextWindow)
  expect(
    renderPrompt(
      composeContext({
        story: { ...story, features: {} },
        lorebookEntries: lore,
      })
    )
  ).not.toContain("[World:")
})
test("feature-on empty story always gets the clock, and older contexts still render", () => {
  const story = {
    ...MOCK_STORIES[0],
    entries: [],
    features: { world: { enabled: true, pacing: "" } },
    world: undefined,
  }
  const ctx = composeContext({ story, lorebookEntries: [] })
  expect(renderPrompt(ctx)).toContain("[World: day 1, night]")
  const { world: _world, ...old } = ctx
  expect(renderPrompt(old)).not.toContain("[World:")
})
