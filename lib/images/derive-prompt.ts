// lib/images/derive-prompt.ts — Offline FALLBACK for prompt derivation.
// Isomorphic, deterministic, no I/O — the same contract as the text mock.
//
// The real path is lib/images/derive-live.ts: the story's own model, given the
// recent manuscript plus memory and triggered lore, asked for one visible
// moment. This runs only when there is no API key, and it is keyword
// extraction, not writing — longest distinctive words from the recent text,
// dropped into a template.
//
// It is kept deliberately, and its output is deliberately a comma-separated
// list rather than a sentence: an offline stand-in that produced fluent prose
// would be indistinguishable from the real derivation, and the one thing a
// writer must never have to wonder is whether the model actually ran.

/**
 * Words that survive extraction but say nothing an image model could draw.
 *
 * Not a general stopword list: it is deliberately short and skewed toward the
 * second-person narration this app produces ("you", "your"), plus the abstract
 * nouns that dominate literary prose and would only ever muddy a prompt.
 */
const IGNORED = new Set([
  "you", "your", "yours", "the", "and", "but", "for", "with", "that", "this",
  "there", "then", "than", "from", "into", "onto", "over", "under", "was",
  "were", "been", "being", "have", "has", "had", "not", "nothing", "something",
  "anything", "everything", "only", "still", "again", "once", "very", "just",
  "which", "what", "when", "where", "would", "could", "should", "about",
  "after", "before", "because", "though", "while", "seemed", "felt", "made",
  "said", "went", "came", "took", "knew", "thought", "himself", "herself",
  "themselves", "yourself", "another", "other", "more", "most", "some", "such",
  "own", "way", "thing", "things", "time", "moment", "kind", "sort", "part",
  // Numbers and quantities: they survive the length filter and pull a picture
  // toward counting things nobody asked to be counted.
  "three", "four", "five", "seven", "eight", "nine", "hundred", "thousand",
  "several", "many", "much", "enough", "half", "whole",
  // Verbs of narration. They read as content because they are long, but an
  // image model can do nothing with "lying" that it could not do without it.
  "lying", "going", "coming", "getting", "having", "looked", "looking",
  "turned", "began", "seeming", "become", "became", "wanted", "needed",
])

/**
 * Openers, so consecutive derivations do not all start with the same words.
 *
 * Deliberately NO art-direction tail. An earlier version appended "ink and
 * wash, high contrast…" here, which put style into the very field that is meant
 * to hold only the scene — the same mistake the live system prompt forbids the
 * model from making. Style is the image profile's to state.
 */
const OPENERS: readonly string[] = [
  "A quiet scene:",
  "Wide shot:",
  "An interior:",
  "A still moment:",
  "Establishing shot:",
]

/**
 * The distinctive words of a passage, longest-first, deduplicated.
 *
 * Longest-first rather than most-frequent: in a passage of 120 words almost
 * nothing repeats, so frequency ranking is noise, while length correlates
 * usefully with specificity ("floorboards" over "room").
 */
function salientWords(text: string, limit: number): string[] {
  const seen = new Set<string>()
  const words: string[] = []
  for (const raw of text.toLowerCase().match(/[a-z][a-z'-]{3,}/g) ?? []) {
    const word = raw.replace(/'s$/, "")
    if (word.length < 5 || IGNORED.has(word) || seen.has(word)) continue
    seen.add(word)
    words.push(word)
  }
  return words.sort((a, b) => b.length - a.length).slice(0, limit)
}

/**
 * A visual prompt for `passageText`, deterministic in `seed`.
 *
 * Returned whole; `streamDerivedPrompt` is what the UI actually consumes.
 */
export function deriveImagePrompt(passageText: string, seed: number): string {
  const index = Math.abs(seed)
  const subjects = salientWords(passageText, 7)
  // A passage with nothing extractable is a real case — a one-line "Yes." of a
  // Say action — and it must produce a usable prompt rather than a bare
  // treatment with a dangling comma.
  const scene =
    subjects.length === 0
      ? "an empty room holding the light of an unremarkable hour"
      : subjects.join(", ")
  return `${OPENERS[index % OPENERS.length]} ${scene}.`
}
