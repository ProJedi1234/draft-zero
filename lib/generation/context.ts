// lib/generation/context.ts — Real context composition. The mock provider is the
// only consumer today, but everything here is what a real provider would send.
// Pure and deterministic: same inputs → same ComposedContext, same prompt.

import type { LorebookEntry, Story } from "@/lib/types"
import { matchActiveLorebookEntries, recentStoryText } from "./lorebook"
import { resolveSystemPrompt } from "./system-prompt"
import type { ActiveLoreEntry, ComposedContext } from "./types"

/** Max characters of story prose carried into context. */
const STORY_CHAR_BUDGET = 24_000
/** Max total characters of lore content carried into context. */
const LORE_CHAR_BUDGET = 8_000
/** Paragraphs are separated by a blank line everywhere in the app. */
const PARAGRAPH_SEPARATOR = "\n\n"
/** Stands in for the story text when there is none, so the turn is never empty. */
const EMPTY_STORY_MARKER =
  "(This story has no text yet. Write its opening paragraph.)"

/**
 * The final STORY_CHAR_BUDGET chars of `text`, cut forward to the next paragraph
 * boundary so the window never starts mid-paragraph. A window with no boundary
 * at all (one very long paragraph) is kept as-is rather than dropped.
 */
function trimStoryText(text: string): string {
  if (text.length <= STORY_CHAR_BUDGET) return text
  const window = text.slice(-STORY_CHAR_BUDGET)
  const boundary = window.indexOf(PARAGRAPH_SEPARATOR)
  if (boundary === -1) return window
  return window.slice(boundary + PARAGRAPH_SEPARATOR.length)
}

/**
 * Greedy inclusion in priority order while cumulative content length stays
 * within LORE_CHAR_BUDGET. An entry too large to fit is skipped and the scan
 * continues, so a high-priority giant never starves everything below it — but
 * order is never reshuffled, so higher priority always survives trimming first.
 */
function trimLore(lore: ActiveLoreEntry[]): ActiveLoreEntry[] {
  const kept: ActiveLoreEntry[] = []
  let used = 0
  for (const item of lore) {
    if (used + item.content.length > LORE_CHAR_BUDGET) continue
    kept.push(item)
    used += item.content.length
  }
  return kept
}

export function composeContext(input: {
  story: Story
  lorebookEntries: LorebookEntry[]
  instruction?: string | null
  variant?: number
}): ComposedContext {
  const { story, lorebookEntries, instruction = null, variant = 0 } = input

  const storyText = trimStoryText(
    story.entries.map((entry) => entry.text).join(PARAGRAPH_SEPARATOR)
  )

  const matches = matchActiveLorebookEntries(
    lorebookEntries,
    recentStoryText(story.entries)
  )
  const lore = trimLore(
    matches.map(({ entry, matchedKey }) => ({
      id: entry.id,
      name: entry.name,
      content: entry.content,
      priority: entry.priority,
      matchedKey,
    }))
  )

  const trimmedInstruction = instruction?.trim() ?? ""

  const context: ComposedContext = {
    systemPrompt: resolveSystemPrompt(story.systemPrompt),
    memory: story.memory,
    lore,
    storyText,
    authorsNote: story.authorsNote,
    instruction: trimmedInstruction === "" ? null : trimmedInstruction,
    seed: story.entries.length + variant,
    approxTokens: 0,
  }
  context.approxTokens = estimateTokens(
    context.systemPrompt + renderPrompt(context)
  )
  return context
}

/** The exact prompt string a real provider would send. */
export function renderPrompt(ctx: ComposedContext): string {
  const blocks: string[] = []

  const memory = ctx.memory.trim()
  if (memory !== "") blocks.push(`[Memory]\n${memory}`)

  for (const entry of ctx.lore) {
    blocks.push(`[Lore: ${entry.name}]\n${entry.content.trim()}`)
  }

  const authorsNote = ctx.authorsNote.trim()
  const authorsNoteBlock =
    authorsNote === "" ? null : `[Author's note: ${authorsNote}]`

  const storyText = ctx.storyText.trim()
  if (storyText === "") {
    // No prose yet. This block is load-bearing: a blank story used to render an
    // empty (or memory-only) user turn, and a model handed a few bracket-tagged
    // sections and nothing else treats them as a document to format — which is
    // where the screenplays came from. Say plainly that the story is empty and
    // what to do about it. The author's note still applies to the opening.
    blocks.push(`[Story]\n${EMPTY_STORY_MARKER}`)
    if (authorsNoteBlock) blocks.push(authorsNoteBlock)
  } else {
    const boundary = storyText.lastIndexOf(PARAGRAPH_SEPARATOR)
    const head = boundary === -1 ? "" : storyText.slice(0, boundary)
    const finalParagraph =
      boundary === -1
        ? storyText
        : storyText.slice(boundary + PARAGRAPH_SEPARATOR.length)

    blocks.push(head === "" ? "[Story]" : `[Story]\n${head}`)
    if (authorsNoteBlock) blocks.push(authorsNoteBlock)
    blocks.push(finalParagraph)
  }

  if (ctx.instruction) blocks.push(`[Instruction]\n${ctx.instruction}`)

  return blocks.join(PARAGRAPH_SEPARATOR)
}

/** ceil(text.length / 4). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}
