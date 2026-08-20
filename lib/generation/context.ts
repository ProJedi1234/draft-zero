// lib/generation/context.ts — Real context composition. The mock provider is the
// only consumer today, but everything here is what a real provider would send.
// Pure and deterministic: same inputs → same ComposedContext, same prompt.

import type { LorebookEntry, Story, StoryEntry } from "@/lib/types"
import { buildScanSources, matchActiveLorebookEntries } from "./lorebook"
import { resolveSystemPrompt } from "./system-prompt"
import type {
  ActiveLoreEntry,
  ComposedContext,
  ContextFit,
  PromptBlock,
} from "./types"

/**
 * The inverse of estimateTokens. Because estimateTokens is ceil(len / 4),
 * `ceil(len / 4) <= W` holds exactly when `len <= 4 * W` — so a token budget
 * converts into a character budget losslessly, with no fudge factor. Everything
 * below therefore budgets in characters and only converts once, at the top.
 */
const CHARS_PER_TOKEN = 4
/**
 * Share of the free budget lore may claim before prose gets the rest. 0.25
 * reproduces the old fixed split (8k lore against 24k prose) at the default
 * window, so existing stories compose roughly as they always did. Anything lore
 * does not spend flows back to prose, which is what matters at the small stops.
 */
const LORE_BUDGET_SHARE = 0.25
/** Paragraphs are separated by a blank line everywhere in the app. */
const PARAGRAPH_SEPARATOR = "\n\n"
/** Stands in for the story text when there is none, so the turn is never empty. */
const EMPTY_STORY_MARKER =
  "(This story has no text yet. Write its opening paragraph.)"
/** Nothing offered, nothing kept — the shape composeContext starts from. */
const EMPTY_FIT: ContextFit = {
  loreMatched: 0,
  storyChars: 0,
  storyCharsKept: 0,
}

/**
 * The final `budget` chars of `text`, cut forward to the next paragraph
 * boundary so the window never starts mid-paragraph. A window with no boundary
 * at all (one very long paragraph) is kept as-is rather than dropped. Trimming
 * from the tail is the whole point: the most recent prose is what the model
 * needs to continue, so it is the last thing we give up.
 */
function trimStoryText(text: string, budget: number): string {
  if (budget <= 0) return ""
  if (text.length <= budget) return text
  const window = text.slice(-budget)
  const boundary = window.indexOf(PARAGRAPH_SEPARATOR)
  if (boundary === -1) return window
  return window.slice(boundary + PARAGRAPH_SEPARATOR.length)
}

/**
 * A player turn, chevroned; generated prose, untouched.
 *
 * Prompt-only — the stored entry text and the UI bubble never carry the marker.
 * Without it a turn is just another paragraph opening with "You", which is what
 * narration looks like too, so the model cannot locate the move it is supposed
 * to respond to. Every turn is marked rather than only the last one: one
 * chevron is a character the model has to interpret, while an alternating
 * column of them is a convention it can read off the page.
 */
function markPlayerTurn(entry: StoryEntry): string {
  return entry.actionKind === null ? entry.text : `> ${entry.text}`
}

/** What one lore entry actually costs once renderPrompt has wrapped it. */
function loreBlockCost(item: ActiveLoreEntry): number {
  return (
    "[Lore: ".length +
    item.name.length +
    "]\n".length +
    item.content.trim().length +
    PARAGRAPH_SEPARATOR.length
  )
}

/**
 * Greedy inclusion in priority order while the cumulative *rendered* cost stays
 * within `budget`. Charging the rendered block (label + separator), not just the
 * content, is what keeps the token guarantee honest — under the old character
 * budget that slop was harmless. An entry too large to fit is skipped and the
 * scan continues, so a high-priority giant never starves everything below it —
 * but order is never reshuffled, so higher priority always survives trimming
 * first. Returns the kept entries and what they cost, since the unspent
 * remainder is handed to prose.
 */
function trimLore(
  lore: ActiveLoreEntry[],
  budget: number
): { kept: ActiveLoreEntry[]; used: number } {
  const kept: ActiveLoreEntry[] = []
  let used = 0
  for (const item of lore) {
    const cost = loreBlockCost(item)
    if (used + cost > budget) continue
    kept.push(item)
    used += cost
  }
  return { kept, used }
}

/**
 * Assemble the context for one generation, trimmed to fit a token budget.
 *
 * Allocation, in priority order: the system prompt, memory and author's note
 * are fixed overhead — they are short, the writer chose them deliberately, and
 * dropping them changes the model's job rather than its recall. Whatever is
 * left after that goes to lore (greedy, priority order, capped at its share)
 * and then to story prose, which absorbs both the prose share and lore's
 * leftovers.
 *
 * The overhead is *measured*, not hand-counted: we render a probe context with
 * no lore and no prose and take its length. That way every bracket label and
 * separator is accounted for automatically and the arithmetic cannot drift out
 * of sync when renderPrompt's block shapes change.
 */
export function composeContext(input: {
  story: Story
  lorebookEntries: LorebookEntry[]
  variant?: number
  /**
   * Token budget override — the model-clamped window. Defaults to the story's
   * own setting. The override exists for the inspector, which knows the
   * selected model's contextLength and shows a live meter before the slider is
   * committed; this function stays pure and never looks a model up itself.
   */
  contextWindow?: number
}): ComposedContext {
  const { story, lorebookEntries, variant = 0 } = input
  const contextWindow = input.contextWindow ?? story.settings.contextWindow

  const matches = matchActiveLorebookEntries(
    lorebookEntries,
    buildScanSources(story)
  )
  const activeLore: ActiveLoreEntry[] = matches.map((match) => ({
    id: match.entry.id,
    name: match.entry.name,
    content: match.entry.content,
    priority: match.entry.priority,
    matchedKey: match.matchedKey,
    depth: match.depth,
    triggeredBy: match.triggeredBy,
    stable: match.stable,
  }))

  const context: ComposedContext = {
    systemPrompt: resolveSystemPrompt(story.systemPrompt),
    memory: story.memory,
    lore: [],
    storyText: "",
    authorsNote: story.authorsNote,
    seed: story.entries.length + variant,
    approxTokens: 0,
    fit: EMPTY_FIT,
  }

  // Probe: the same context with nothing budgeted into it yet. Its length is
  // the overhead we cannot trim away.
  const charBudget = contextWindow * CHARS_PER_TOKEN
  const fixedChars = context.systemPrompt.length + renderPrompt(context).length
  const remaining = Math.max(0, charBudget - fixedChars)

  const { kept, used } = trimLore(
    activeLore,
    Math.floor(remaining * LORE_BUDGET_SHARE)
  )
  context.lore = kept
  // Markers are applied before budgeting, so `fit` counts the same chars the
  // budget spends and the two cannot disagree about what a turn costs.
  const fullStoryText = story.entries
    .map(markPlayerTurn)
    .join(PARAGRAPH_SEPARATOR)
  context.storyText = trimStoryText(fullStoryText, remaining - used)

  // Reconcile. The probe renders the *empty* story shape (two blocks) while a
  // real story renders three, so the estimate is off by a couple of separator
  // chars — close enough to argue about, not close enough to promise. Drop
  // leading paragraphs until the promise actually holds. This terminates on the
  // paragraph count, and bottoms out at a single unsplittable paragraph: when
  // the overhead alone exceeds the window — the ladder's 2k floor leaves room
  // for the default system prompt, but a long memory plus a long author's note
  // can still eat a small stop — nothing is left to drop and approxTokens
  // legitimately overshoots. Hence "whenever achievable".
  context.approxTokens = measure(context)
  while (context.approxTokens > contextWindow) {
    const boundary = context.storyText.indexOf(PARAGRAPH_SEPARATOR)
    if (boundary === -1) break
    context.storyText = context.storyText.slice(
      boundary + PARAGRAPH_SEPARATOR.length
    )
    context.approxTokens = measure(context)
  }

  // Last, because the reconcile loop above is still allowed to drop paragraphs:
  // what the writer is owed is what SURVIVED, measured against what was offered.
  context.fit = {
    loreMatched: activeLore.length,
    storyChars: fullStoryText.trim().length,
    // Trimmed at both ends for the same reason renderPrompt trims: the leading
    // separator a mid-paragraph cut leaves behind is not prose that fit.
    storyCharsKept: context.storyText.trim().length,
  }

  return context
}

/** Tokens actually on the wire: system turn + user turn, exactly as sent. */
function measure(ctx: ComposedContext): number {
  return estimateTokens(ctx.systemPrompt + renderPrompt(ctx))
}

/**
 * The user turn, as the labelled blocks it is actually built from.
 *
 * renderPrompt is this joined back together, so the two can never disagree
 * about what was sent — which is the whole point of splitting it out. The
 * context viewer slices the prompt by these blocks rather than by searching the
 * finished string for bracket labels, so a block shape that changes here
 * changes the breakdown with it and nothing has to be kept in sync.
 */
export function promptBlocks(ctx: ComposedContext): PromptBlock[] {
  const blocks: PromptBlock[] = []

  const memory = ctx.memory.trim()
  if (memory !== "") {
    blocks.push({ section: "memory", text: `[Memory]\n${memory}` })
  }

  for (const entry of ctx.lore) {
    blocks.push({
      section: "lore",
      loreId: entry.id,
      text: `[Lore: ${entry.name}]\n${entry.content.trim()}`,
    })
  }

  const authorsNote = ctx.authorsNote.trim()
  const authorsNoteBlock: PromptBlock | null =
    authorsNote === ""
      ? null
      : { section: "authorsNote", text: `[Author's note: ${authorsNote}]` }

  const storyText = ctx.storyText.trim()
  if (storyText === "") {
    // No prose yet. This block is load-bearing: a blank story used to render an
    // empty (or memory-only) user turn, and a model handed a few bracket-tagged
    // sections and nothing else treats them as a document to format — which is
    // where the screenplays came from. Say plainly that the story is empty and
    // what to do about it. The author's note still applies to the opening.
    blocks.push({ section: "story", text: `[Story]\n${EMPTY_STORY_MARKER}` })
    if (authorsNoteBlock) blocks.push(authorsNoteBlock)
  } else {
    const boundary = storyText.lastIndexOf(PARAGRAPH_SEPARATOR)
    const head = boundary === -1 ? "" : storyText.slice(0, boundary)
    const finalParagraph =
      boundary === -1
        ? storyText
        : storyText.slice(boundary + PARAGRAPH_SEPARATOR.length)

    blocks.push({
      section: "story",
      text: head === "" ? "[Story]" : `[Story]\n${head}`,
    })
    if (authorsNoteBlock) blocks.push(authorsNoteBlock)
    blocks.push({ section: "story", text: finalParagraph })
  }

  return blocks
}

/** The exact prompt string a real provider would send. */
export function renderPrompt(ctx: ComposedContext): string {
  return promptBlocks(ctx)
    .map((block) => block.text)
    .join(PARAGRAPH_SEPARATOR)
}

/** ceil(text.length / 4). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}
