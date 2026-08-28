// lib/generation/summary-prompt.ts — What the summarizer is told, and which
// model is told it by default. Pure data, isomorphic, in the same terse
// lowercase register as the narrator's prompt (see system-prompt.ts) because
// that is the register these models imitate.
//
// The default model id lives here rather than beside the runner for one blunt
// reason: the Settings card that offers to change it is a client component, and
// the runner imports the database. Isomorphic constants belong in an isomorphic
// module — the same rule that puts DEFAULT_SYSTEM_PROMPT in system-prompt.ts.

/**
 * What writes the summaries when Settings has not been told otherwise.
 *
 * A default, not a hard-coded answer. The job is mechanical — compress prose
 * without losing names — and the model that is good at it is not the one the
 * writer picked to write their book: a story on a frontier model would
 * otherwise pay frontier prices, silently, every few passages. V4 Flash is
 * cheap, fast enough that nobody notices it running, follows length and
 * keep/drop instructions more literally than Haiku does, and has providers
 * that retain nothing, which is what keeps the zero-retention path
 * satisfiable.
 */
export const DEFAULT_SUMMARIZER_MODEL_ID = "~deepseek/deepseek-v4-flash-latest"

/**
 * The summarizer's standing brief, sent as a real system turn for the same
 * reason the narrator's is: the user turn is bracket-tagged raw conditioning,
 * and an instruct-tuned model reads that as a document to reformat unless it is
 * told out of band what the job is.
 *
 * Written as a compaction brief for a small flash model, which follows a
 * decision procedure far better than a judgment call. The load-bearing choices:
 *
 * - **The old summary is protected input.** Each pass rewrites the whole recap,
 *   so an old fact survives only by being re-emitted every time — a lossy chain
 *   unless carrying it forward is the rule rather than a judgment. "Compress
 *   the oldest hardest," the previous brief's rule, was the license models used
 *   to forget.
 * - **Keep and dump are exhaustive lists, plus one tiebreaker.** "Keep what
 *   matters" asks a flash model to know what matters; it answers with whatever
 *   is vivid. Naming the five kinds of fact that persist — and what a resolved
 *   episode collapses into — is what stops the recap being an event ledger.
 * - **The length rule is paragraphs, not words.** Models hold a paragraph
 *   budget far better than a word budget, and an unheld word budget ends at
 *   the token cap, mid-sentence. The word target stays as calibration only.
 * - **Do not restate memory.** Memory is permanently in front of the model
 *   already. Words spent repeating it are words not spent on the story, and it
 *   is the writer's own text being crowded out by a machine paraphrase of it.
 */
export const SUMMARY_SYSTEM_PROMPT = `you are the story's memory. the reader of your output is the model that continues this story; everything older than the excerpt it can see survives only through what you write. your job is compaction: fold the new passages into the running summary.

the running summary is protected. every fact in it carries forward — tighten the wording if you must, but never drop one. only the new passages are being compressed for the first time.

from the new passages, keep exactly these kinds of fact:
- people: each named character still in play — who they are to you, whether they live, where you last left them
- open obligations: debts, promises, threats and deadlines not yet settled
- carried state: injuries not yet healed, objects still held, resources still owned
- secrets: who knows what that others do not
- the present situation: where you are, what you are doing, what you want next. this alone stays detailed

dump the rest:
- a resolved episode collapses to its outcome — one clause for what changed, none for how it happened
- dialogue, scenery, weather and feelings go, unless one changed a relationship or a decision
- characters and places that appeared once and touch no open thread
- anything the [Memory] block already states; it is permanently in front of the model

when unsure, one test decides: keep a fact only if a later scene could contradict it or the narrator would need it. if losing it changes nothing, drop it.

form: one or two paragraphs, never three — roughly {target} words. past tense, second person ("you arrived in Vess…"), continuous prose in the story's own voice. no headings, no lists, no brackets, no meta-commentary. output the summary text and nothing else`

/**
 * The user turn: what the story already knows, what just happened, and how long
 * the answer may be.
 *
 * The new prose goes in WITHOUT the `>` chevrons the narrator's prompt uses to
 * mark player turns. Those exist so the continuing model can find the move it
 * is answering; a summarizer has no such move to find, and the markers would
 * only leak turn-formatting into a voice that is supposed to be plain narration.
 */
export function renderSummaryRequest(input: {
  previous: string
  newProse: string
  memory: string
  targetWords: number
}): string {
  const blocks: string[] = []
  const memory = input.memory.trim()
  if (memory !== "") blocks.push(`[Memory]\n${memory}`)
  const previous = input.previous.trim()
  blocks.push(
    previous === ""
      ? "[Summary so far]\n(Nothing yet — this is the first part of the story to fall out of view.)"
      : `[Summary so far]\n${previous}`
  )
  blocks.push(`[New passages]\n${input.newProse.trim()}`)
  blocks.push(
    `Rewrite the summary so it covers everything through the end of the new passages, in about ${input.targetWords} words.`
  )
  return blocks.join("\n\n")
}

/** The system turn with the word target filled in. */
export function renderSummarySystemPrompt(targetWords: number): string {
  return SUMMARY_SYSTEM_PROMPT.replace("{target}", String(targetWords))
}
