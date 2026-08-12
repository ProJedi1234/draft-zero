// lib/story/action-voice.ts — Turns the writer's first-person input into the
// second-person prose that lands on the page. The writer types "I shove the
// door"; the manuscript reads "You shove the door."
//
// This is a pure, deterministic, isomorphic function with no runtime imports on
// purpose: the server action writes the translation, the composer renders an
// optimistic echo of it before the round trip, and the test suite pins it. If
// any of those three could disagree the writer would watch their own sentence
// change under them after the save, so all three call exactly this code.
//
// It is a text transform, not a parser. It will mangle sentences a parser would
// get right — the accepted failures are enumerated below and pinned in
// action-voice.test.ts so that a later reader can tell "we chose this" from
// "this is broken".

import type { ActionKind } from "@/lib/types"

/**
 * Sentinel wrapping a masked quotation. NUL cannot survive a text input, a
 * paste, or a database round trip, so a placeholder built from it can never
 * collide with something the writer actually typed — which matters because a
 * collision would silently swap two spans of the writer's prose.
 */
const MASK_OPEN = "\u0000"
const MASK_CLOSE = "\u0000"

/**
 * Straight and curly double quotes only. Single quotes are deliberately absent:
 * they are indistinguishable from the apostrophes in "don't" and "sister's", so
 * treating them as quotation marks would mask half a sentence.
 */
const QUOTED_SPAN = /"[^"]*"|“[^”]*”/g

/** Characters that already end a sentence, so we must not append a full stop. */
const TERMINAL_PUNCTUATION = /[.?!…]$/
/** Straight or curly closing double quote. */
const CLOSING_QUOTE = /["”]$/

interface PronounRule {
  /** Regex source, spliced into one alternation. */
  source: string
  /** Second-person form, written lowercase; casing is restored per match. */
  to: string
  /**
   * Leave the ALL-CAPS spelling alone. Set on `we` and `us` so the initialism
   * "US" survives ("the US embassy is burning") — a shouted "WE" surviving into
   * second-person prose is rarer than that, and rarer still than the ordinary
   * sentence-initial "We" this guard used to swallow.
   */
  skipAllCaps?: boolean
}

/**
 * The first-to-second person map, longest form first. Order is load-bearing in
 * two places: the contractions must precede bare `I` and `we` (an apostrophe is
 * a word boundary, so `\bI\b` happily matches inside "I'm" and would leave
 * "you'm"), and `ourselves` must precede `our`.
 *
 * Every contraction accepts the straight apostrophe and the curly one, because
 * writers paste from editors that silently substitute the latter and a missed
 * "I’m" is a first-person pronoun surviving into second-person prose.
 */
const PRONOUN_RULES: readonly PronounRule[] = [
  { source: "ourselves", to: "yourself" },
  { source: "myself", to: "yourself" },
  { source: "we['’]re", to: "you're" },
  { source: "we['’]ve", to: "you've" },
  { source: "we['’]ll", to: "you'll" },
  { source: "we['’]d", to: "you'd" },
  { source: "I['’]ve", to: "you've" },
  { source: "I['’]ll", to: "you'll" },
  { source: "I['’]m", to: "you're" },
  { source: "I['’]d", to: "you'd" },
  { source: "ours", to: "yours" },
  // "mine" is a noun as often as it is a pronoun. Refusing to rewrite it after a
  // determiner is what keeps "I enter the abandoned mine" from becoming "You
  // enter the abandoned yours"; nothing else in this map is ambiguous enough to
  // need the guard. Up to three words may sit between the determiner and the
  // noun ("the old flooded mine"), but none of them may be a form of *be*:
  // "the key is mine" is the pronoun, and the copula is what tells them apart.
  {
    source:
      "(?<!\\b(?:the|a|an|this|that|its|his|her|their)\\s(?:(?!(?:is|was|are|were|be|been)\\s)\\w+\\s){0,3})mine",
    to: "yours",
  },
  { source: "our", to: "your" },
  { source: "my", to: "your" },
  { source: "us", to: "you", skipAllCaps: true },
  { source: "we", to: "you", skipAllCaps: true },
  { source: "me", to: "you" },
  { source: "I", to: "you" },
]

const PRONOUN_PATTERN = new RegExp(
  `\\b(?:${PRONOUN_RULES.map((rule) => rule.source).join("|")})\\b`,
  "gi"
)

/** Anchored matchers, index-aligned with PRONOUN_RULES, to identify a hit. */
const PRONOUN_MATCHERS = PRONOUN_RULES.map(
  (rule) => new RegExp(`^(?:${rule.source})$`, "i")
)

/**
 * Verbs that introduce speech. Used only to strip a preamble the writer typed
 * out of habit ("I tell her, …"), never to classify anything: the writer has
 * already told us this is a Say by pressing the Say button.
 */
const SPEECH_VERBS = [
  "say",
  "says",
  "said",
  "tell",
  "told",
  "ask",
  "asks",
  "asked",
  "shout",
  "yell",
  "whisper",
  "mutter",
  "murmur",
  "reply",
  "answer",
  "respond",
  "call",
  "snap",
  "add",
  "explain",
  "insist",
  "admit",
  "scream",
  "hiss",
  "growl",
].join("|")

/**
 * "I whisper urgently: get down" — everything from the verb to the punctuation
 * that introduces the quotation goes. The gap is capped at 40 characters so a
 * comma late in a long sentence cannot swallow the first clause of what the
 * writer meant to say; it is lazy so "I say, hello" stops at the first comma.
 */
const SAY_PREAMBLE_WITH_BREAK = new RegExp(
  `^(?:i|we)\\s+(?:${SPEECH_VERBS})\\b[^,:—–]{0,40}?\\s*(?:[,:—–]|\\s-\\s)+\\s*(?:that\\s+)?`,
  "i"
)

/**
 * The same preamble without any punctuation to end it — "i tell her I'm not
 * leaving". With no punctuation to mark where the preamble stops, something
 * else has to: either an addressee from a short closed set, or an explicit
 * "that". Both are mandatory here, and that is the whole guard — a bare
 * "i <verb> <words>" is NOT stripped, because "I told you so" and "i say
 * nothing moved" are lines the writer meant to speak, not preambles, and
 * eating their first two words is silent content deletion.
 *
 * ACCEPTED FAILURE: with an addressee present the split is still a guess, so
 * "I call him a liar" comes out as You say, "A liar." Distinguishing that from
 * "I tell her I'm not leaving" needs a parser, and the preamble strip is worth
 * more than the handful of verb-plus-object lines it mangles.
 */
const SAY_PREAMBLE_BARE = new RegExp(
  `^(?:i|we)\\s+(?:${SPEECH_VERBS})\\b(?:\\s+(?:to\\s+)?(?:him|her|them|it|everyone|anyone|someone|the\\s+\\w+)(?:\\s+that)?|\\s+that)\\s+`,
  "i"
)

/** A turn is one paragraph, so newlines the writer typed collapse to spaces. */
function normalize(raw: string): string {
  return raw.replace(/\s+/g, " ").trim()
}

/** "US" and "I'VE" are all-caps; "Us", "us" and single-letter "I" are not. */
function isAllCaps(text: string): boolean {
  return /[a-z]/i.test(text) && text.length > 1 && text === text.toUpperCase()
}

/** Re-dresses `replacement` in the capitalisation of the text it replaces. */
function matchCase(replacement: string, matched: string): string {
  if (isAllCaps(matched)) {
    return replacement.toUpperCase()
  }
  if (matched[0] === matched[0].toUpperCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1)
  }
  return replacement
}

/** Uppercases the first letter, stepping over an opening quotation mark. */
function capitalize(text: string): string {
  const index = text.search(/[a-z]/i)
  if (index === -1) return text
  return (
    text.slice(0, index) + text[index].toUpperCase() + text.slice(index + 1)
  )
}

/**
 * Ends the sentence. A trailing quotation gets its stop *inside* the quote —
 * `You tell her, "…sister."` — because a full stop parked outside a closing
 * quote is the one typographic error every reader notices.
 */
function punctuate(text: string): string {
  if (CLOSING_QUOTE.test(text)) {
    const inner = text.slice(0, -1)
    if (TERMINAL_PUNCTUATION.test(inner)) return text
    return `${inner}.${text.slice(-1)}`
  }
  if (TERMINAL_PUNCTUATION.test(text)) return text
  return `${text}.`
}

/**
 * Curls the straight double quotes inside a Say. The rendering wraps the line
 * in straight quotes of its own, so a straight quote the writer typed inside it
 * would close the wrapper early — 'she called it a "gift"' rendering as
 * You say, "She called it a "gift."" Alternating open/close survives an odd
 * count, which a paired-span regex would leave behind as a stray.
 */
function curlQuotes(text: string): string {
  let open = true
  return text.replace(/"/g, () => {
    open = !open
    return open ? "”" : "“"
  })
}

/** Strips one layer of matched surrounding double quotes, straight or curly. */
function unwrapQuotes(text: string): string {
  const straight = /^"([^"]*)"$/.exec(text)
  if (straight) return straight[1].trim()
  const curly = /^“([^”]*)”$/.exec(text)
  if (curly) return curly[1].trim()
  return text
}

/**
 * Rewrites first-person pronouns as second-person ones. Used by Do only — see
 * the comment in `translateSay` for why Say must never call this.
 */
function shiftPronouns(text: string): string {
  return text.replace(PRONOUN_PATTERN, (matched) => {
    const index = PRONOUN_MATCHERS.findIndex((matcher) => matcher.test(matched))
    if (index === -1) return matched
    const rule = PRONOUN_RULES[index]
    if (rule.skipAllCaps && isAllCaps(matched)) return matched
    return matchCase(rule.to, matched)
  })
}

/**
 * Adverbs allowed to stand between the pronoun and its verb ("I still am not
 * sure"). A closed list plus -ly rather than "any word": an open gap would let
 * `you … was` reach across a clause boundary and rewrite a *different*
 * subject's verb, as in "You run and the guard was there".
 */
const AGREEMENT_ADVERBS = [
  "\\w+ly",
  "still",
  "never",
  "always",
  "almost",
  "already",
  "just",
  "barely",
  "hardly",
  "nearly",
  "once",
  "again",
  "also",
  "even",
  "maybe",
  "perhaps",
  "now",
  "then",
  "sure",
].join("|")

const BE_AGREEMENT = new RegExp(
  `\\b(you)((?:\\s+(?:${AGREEMENT_ADVERBS}))*\\s+)(am|was)\\b`,
  "gi"
)

/**
 * Fixes verb agreement after the pronoun shift — and only for *be*. This is the
 * non-obvious fact that keeps this file small: English first and second person
 * are identical in every other verb, so "I run" → "you run" and "I have" →
 * "you have" need no help. Only am/was differ, so only am/was are listed.
 */
function fixBeAgreement(text: string): string {
  return text.replace(
    BE_AGREEMENT,
    (_match, pronoun: string, gap: string, verb: string) =>
      pronoun +
      gap +
      matchCase(verb.toLowerCase() === "am" ? "are" : "were", verb)
  )
}

function translateDo(text: string): string {
  // Quotations are masked before anything else touches the sentence: the words
  // inside them are dialogue, spoken by the player character in their own "I",
  // and shifting those pronouns would put the narrator's voice in the
  // character's mouth.
  const quotations: string[] = []
  let masked = text.replace(QUOTED_SPAN, (span) => {
    quotations.push(span)
    return `${MASK_OPEN}${quotations.length - 1}${MASK_CLOSE}`
  })

  masked = fixBeAgreement(shiftPronouns(masked))

  // ACCEPTED FAILURE: the prefix is naive. "the guard turns around" becomes
  // "You the guard turns around." because nothing here knows what a subject is,
  // and a heuristic that guessed would be wrong less visibly. Likewise only the
  // first sentence of a multi-sentence Do is prefixed.
  if (!/^you\b/i.test(masked)) masked = `You ${masked}`

  const unmasked = masked.replace(
    new RegExp(`${MASK_OPEN}(\\d+)${MASK_CLOSE}`, "g"),
    (_match, index: string) => quotations[Number(index)]
  )

  return punctuate(capitalize(unmasked))
}

function translateSay(text: string): string {
  // The quotes the writer typed around their line are ours to re-add, so strip
  // them; the preamble strip can expose a second layer ('i tell her, "get
  // out"'), which is why the unwrap runs on both sides of it.
  let inner = unwrapQuotes(text)

  // ACCEPTED FAILURE: the speech verb and everything with it is discarded, so
  // "I whisper: don't move" comes out as You say, "Don't move." — the manner is
  // lost. Keeping it would mean generating narration ("You whisper, …") that
  // the writer did not choose, and Say has exactly one rendering by decision.
  const stripped = inner
    .replace(SAY_PREAMBLE_WITH_BREAK, "")
    .replace(SAY_PREAMBLE_BARE, "")
    .trim()
  // A preamble that consumed the entire line was not a preamble — a bare
  // "I shout:" has no line after it, so keep what the writer typed.
  if (stripped.length > 0) inner = unwrapQuotes(stripped)

  if (inner.length === 0) return ""

  // Say does NOT shift pronouns, and must not be "fixed" to. Do is narration
  // about the player, so its "I" is the narrator's "you"; Say is the player
  // character *speaking*, and a speaker refers to themselves as "I". Rewriting
  // here would produce You say, "You're not leaving without your sister." —
  // the character addressing someone else with their own line. This asymmetry
  // is the whole difference between the two modes.
  return `You say, "${punctuate(capitalize(curlQuotes(inner)))}"`
}

/**
 * Translates one first-person action into the second-person prose stored on the
 * entry and shown in the manuscript. Empty or whitespace-only input yields "",
 * which callers treat as "nothing to submit".
 */
export function translateAction(kind: ActionKind, raw: string): string {
  const text = normalize(raw)
  if (text.length === 0) return ""
  return kind === "say" ? translateSay(text) : translateDo(text)
}
