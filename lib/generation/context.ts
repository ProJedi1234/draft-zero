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
/** Paragraphs are separated by a blank line everywhere in the app. */
const PARAGRAPH_SEPARATOR = "\n\n"
/**
 * How far the story window's leading edge moves at a time, as a fraction of the
 * prose budget, and the absolute bounds on that.
 *
 * Trimming to the exact budget would move that edge on EVERY turn once the
 * window is full: one passage in at the tail, one paragraph out at the head, a
 * different prefix each time. Nothing upstream could then cache any of it,
 * because a cache is a prefix match and the prefix changed. Advancing in quanta
 * instead means the head is byte-identical from one turn to the next until
 * enough new prose has accumulated to justify one jump.
 *
 * The cost is real and bounded: up to one quantum of the window sits unused
 * between jumps. That is why the quantum is a FRACTION of the budget rather
 * than a fixed number of characters — a constant generous enough to be worth
 * having at a 128k window would eat a quarter of an 8k one. An eighth caps the
 * waste at 12.5% wherever the writer puts the slider, and still buys a head
 * that only moves every several turns.
 *
 * The ceiling keeps the jumps from becoming enormous (and the waste absolute
 * rather than proportional) on a very large window; the floor keeps the
 * quantum from shrinking to nothing at the bottom of the ladder, where it would
 * degenerate back into exact trimming.
 */
const STORY_TRIM_QUANTUM_DIVISOR = 8
const STORY_TRIM_QUANTUM_MIN = 512
const STORY_TRIM_QUANTUM_MAX = 8000

/** The quantum for a given prose budget. See the constants above. */
function trimQuantum(budget: number): number {
  return Math.min(
    STORY_TRIM_QUANTUM_MAX,
    Math.max(
      STORY_TRIM_QUANTUM_MIN,
      Math.floor(budget / STORY_TRIM_QUANTUM_DIVISOR)
    )
  )
}
/** Stands in for the story text when there is none, so the turn is never empty. */
const EMPTY_STORY_MARKER =
  "(This story has no text yet. Write its opening paragraph.)"
/** Nothing offered, nothing kept — the shape composeContext starts from. */
const EMPTY_FIT: ContextFit = {
  loreMatched: 0,
  loreStableMatched: 0,
  storyChars: 0,
  storyCharsKept: 0,
}

/**
 * The final `budget` chars of `text`, cut forward to the next paragraph
 * boundary so the window never starts mid-paragraph.
 *
 * The cut point is QUANTIZED: rather than keeping exactly `budget` characters,
 * we keep the largest whole number of quanta that fits, so the leading edge
 * only moves when the story has grown by a whole quantum. See
 * STORY_TRIM_QUANTUM. A window with no paragraph boundary at all (one very long
 * paragraph) is kept as-is rather than dropped. Trimming from the tail is the
 * whole point: the most recent prose is what the model needs to continue, so it
 * is the last thing we give up.
 */
function trimStoryText(text: string, budget: number): string {
  if (budget <= 0) return ""
  if (text.length <= budget) return text

  // The window's START is what gets quantized, as an absolute offset from the
  // beginning of the manuscript — NOT the length that is kept.
  //
  // The distinction is the whole feature. Keeping a quantized *length* still
  // means slicing that many characters off the end, and the end moves every
  // turn, so the head slides forward by one passage each time and no two turns
  // share a prefix. Rounding the earliest allowed start UP to a multiple of the
  // quantum pins the window to a fixed character offset instead: the prose
  // before it is append-only, so that offset names the same byte on every turn
  // and only jumps once the story has grown a whole quantum past it.
  const quantum = trimQuantum(budget)
  const earliestStart = text.length - budget
  const start =
    budget >= quantum
      ? Math.ceil(earliestStart / quantum) * quantum
      : // A budget smaller than one quantum has nothing to round to: rounding
        // up would land past the end of the story and empty the window.
        earliestStart

  const window = text.slice(start)
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
 * left after that goes to lore (greedy, priority order, capped at the story's
 * loreBudget share) and then to story prose, which absorbs both the prose share
 * and lore's leftovers.
 *
 * Lore is budgeted as ONE pool and then split into two zones by where it is
 * sent, not by what it may spend: stable entries (always-on, or triggered by
 * memory and the author's note) go in the cacheable head above the story,
 * volatile ones (triggered by the story window) go beside the recent prose that
 * summoned them. Stable is offered first because its activation is the writer's
 * standing decision rather than an accident of where the prose happens to be.
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
  /** Lore share override, same reason as contextWindow: a live slider. */
  loreBudget?: number
}): ComposedContext {
  const { story, lorebookEntries, variant = 0 } = input
  const contextWindow = input.contextWindow ?? story.settings.contextWindow
  const loreBudget = input.loreBudget ?? story.settings.loreBudget

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

  // One pool, offered stable-first. Both zones draw from it in priority order
  // within themselves, so a low-priority stable entry can still displace a
  // high-priority volatile one — which is the intended trade: the writer's
  // standing lore outranks whatever the last four passages happened to say.
  const stableLore = activeLore.filter((item) => item.stable)
  const volatileLore = activeLore.filter((item) => !item.stable)
  const lorePool = Math.floor((remaining * loreBudget) / 100)
  const stableFit = trimLore(stableLore, lorePool)
  const volatileFit = trimLore(volatileLore, lorePool - stableFit.used)
  context.lore = [...stableFit.kept, ...volatileFit.kept]
  const loreUsed = stableFit.used + volatileFit.used

  // Markers are applied before budgeting, so `fit` counts the same chars the
  // budget spends and the two cannot disagree about what a turn costs.
  const fullStoryText = story.entries
    .map(markPlayerTurn)
    .join(PARAGRAPH_SEPARATOR)
  context.storyText = trimStoryText(fullStoryText, remaining - loreUsed)

  // Reconcile. The probe renders the *empty* story shape (two blocks) while a
  // real story renders three, so the estimate is off by a couple of separator
  // chars — close enough to argue about, not close enough to promise. Drop
  // leading paragraphs until the promise actually holds. This terminates on the
  // paragraph count, and bottoms out at a single unsplittable paragraph: when
  // the overhead alone exceeds the window — the ladder's 2k floor leaves room
  // for the default system prompt, but a long memory plus a long author's note
  // can still eat a small stop — nothing is left to drop and approxTokens
  // legitimately overshoots. Hence "whenever achievable".
  //
  // Quantized trimming above leaves headroom for this in the ordinary case, so
  // the loop is normally a no-op rather than a per-turn nibble at the anchor.
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
    loreStableMatched: stableLore.length,
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
 *
 * The order — memory, stable lore, story head, volatile lore, author's note,
 * final paragraph — is chosen so that everything a turn cannot change sits in
 * front of everything it can. See composeContext for the zones, and
 * promptSegments for what an upstream cache is asked to keep.
 */
export function promptBlocks(ctx: ComposedContext): PromptBlock[] {
  const blocks: PromptBlock[] = []

  const memory = ctx.memory.trim()
  if (memory !== "") {
    blocks.push({ section: "memory", text: `[Memory]\n${memory}` })
  }

  for (const entry of ctx.lore) {
    if (!entry.stable) continue
    blocks.push({
      section: "lore",
      loreId: entry.id,
      text: `[Lore: ${entry.name}]\n${entry.content.trim()}`,
    })
  }

  const volatileLore = ctx.lore.filter((entry) => !entry.stable)
  const volatileBlocks: PromptBlock[] = volatileLore.map((entry) => ({
    section: "lore",
    loreId: entry.id,
    text: `[Lore: ${entry.name}]\n${entry.content.trim()}`,
  }))

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
    blocks.push(...volatileBlocks)
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
    // Volatile lore rides between the manuscript and its final paragraph, in
    // the same slot the author's note already occupies and for the same reason:
    // it was triggered by the recent prose, and this is where recency weighting
    // is strongest.
    blocks.push(...volatileBlocks)
    if (authorsNoteBlock) blocks.push(authorsNoteBlock)
    blocks.push({ section: "story", text: finalParagraph })
  }

  return blocks
}

/**
 * One piece of the user turn as it goes on the wire, and whether an upstream
 * cache should be asked to keep it.
 *
 * Concatenating every segment's text — in order, with no separator — gives
 * renderPrompt(ctx) exactly. That identity is what lets the request be split
 * into content parts without changing a byte of what the model reads, and it is
 * asserted in the tests rather than assumed.
 *
 * Two cacheable segments, which is the shape the caching actually wants: the
 * head (memory + stable lore) changes only when the writer edits it, and the
 * manuscript head changes only when the trim anchor jumps a whole quantum. The
 * tail — volatile lore, the author's note, the newest paragraph — is expected
 * to differ every turn and is deliberately left unmarked.
 */
export interface PromptSegment {
  text: string
  /** Whether to ask the provider to cache everything up to the end of this segment. */
  cache: boolean
}

export function promptSegments(ctx: ComposedContext): PromptSegment[] {
  const blocks = promptBlocks(ctx)
  // The first story block is the manuscript head; everything before it is the
  // stable head, everything after it is the volatile tail.
  const storyStart = blocks.findIndex((block) => block.section === "story")
  const head = storyStart === -1 ? blocks : blocks.slice(0, storyStart)
  const manuscript = storyStart === -1 ? [] : [blocks[storyStart]!]
  const tail = storyStart === -1 ? [] : blocks.slice(storyStart + 1)

  const segments: PromptSegment[] = []
  const join = (parts: PromptBlock[]) =>
    parts.map((block) => block.text).join(PARAGRAPH_SEPARATOR)

  if (head.length > 0) {
    // The separator that follows this segment belongs to it, so the pieces
    // concatenate back to the prompt with nothing between them.
    segments.push({
      text: join(head) + (manuscript.length > 0 ? PARAGRAPH_SEPARATOR : ""),
      cache: true,
    })
  }
  if (manuscript.length > 0) {
    segments.push({
      text: join(manuscript) + (tail.length > 0 ? PARAGRAPH_SEPARATOR : ""),
      cache: true,
    })
  }
  if (tail.length > 0) {
    segments.push({ text: join(tail), cache: false })
  }
  return segments
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
