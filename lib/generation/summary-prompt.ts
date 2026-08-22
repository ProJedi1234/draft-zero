// lib/generation/summary-prompt.ts — What the summarizer is told. Pure data,
// isomorphic, in the same terse lowercase register as the narrator's prompt
// (see system-prompt.ts) because that is the register these models imitate.

/**
 * The summarizer's standing brief, sent as a real system turn for the same
 * reason the narrator's is: the user turn is bracket-tagged raw conditioning,
 * and an instruct-tuned model reads that as a document to reformat unless it is
 * told out of band what the job is.
 *
 * Three of these rules are load-bearing and were not obvious:
 *
 * - **Hard facts over color.** A prose summary's natural failure is to keep the
 *   mood and lose the name, and a name lost here is lost permanently — the
 *   prose it came from is already out of the window.
 * - **Fold, do not append.** Without this the recap becomes a changelog that
 *   grows until it is trimmed, and the oldest events (which need compressing
 *   most) are the ones written most verbosely.
 * - **Do not restate memory.** Memory is permanently in front of the model
 *   already. Words spent repeating it are words not spent on the story, and it
 *   is the writer's own text being crowded out by a machine paraphrase of it.
 */
export const SUMMARY_SYSTEM_PROMPT = `you are the story's memory. the reader of your output is the model that continues this story; everything older than the excerpt it can see survives only through what you write. rewrite the running summary so it covers everything through the end of the new passages. follow these rules:
- write past tense, second person ("you arrived in Vess…"), continuous prose in the story's own voice. no headings, no lists, no brackets, no meta-commentary. output the summary text and nothing else
- keep every hard fact that still matters: names, places, debts owed, injuries carried, promises made, deadlines, objects held, who knows what. these are what summaries lose; a fact dropped here is gone for good
- fold the new passages into the summary rather than appending them. compress the oldest events hardest and keep the recent ones sharpest
- the [Memory] block is permanently in front of the model already. never restate its facts — spend your words on what it does not say
- aim for about {target} words. when something must go, cut color before facts`

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
