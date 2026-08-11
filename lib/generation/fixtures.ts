// lib/generation/fixtures.ts — Deterministic mock continuations + the chunker.
// Exported separately from the provider so tests can dependency-inject them.
//
// House rules for the prose: genre-neutral, past tense, no second person, no
// proper nouns, no story-specific detail. Each fixture must be able to follow
// ANY passage — or open a blank page — without contradicting it. Two paragraphs
// separated by "\n\n" so streamed output exercises multi-paragraph rendering.

/** 8 deterministic continuations, each 2 paragraphs (~80–140 words). Written once, never randomized. */
export const FIXTURE_CONTINUATIONS: readonly string[] = [
  "The rain had stopped sometime in the night, and what remained was the sound of water finding its way down from the eaves, one slow bead at a time. The room held the grey of early morning like something borrowed, and nothing moved in it except the curtain, and that only when the window admitted a little of the cold.\n\nFor a while there was no decision to be made, only the weight of the hour and the ordinary miracle of having woken at all. Then, from somewhere below, a door opened and closed again — not urgently, not quietly either — and the day, which had been waiting politely at the threshold, came in without being asked.",

  "The light came in low and yellow across the floorboards, marking out the shapes of things that had been left where they fell. Dust turned slowly through it, patient as ash. Somewhere a clock kept time for no one in particular, and the sound of it was less a measure than a companion.\n\nFootsteps crossed the room above, paused, and went on. There was no need to look up; the ceiling told the whole story in its small complaints. A breath was drawn and held a beat too long before it was let go. Whatever had been decided in the hours before dawn had not yet been spoken aloud, and until it was, the morning could be pretended into something ordinary.",

  "Wind came up off the water and turned the leaves over, showing their pale undersides the way they do before weather. The air smelled of iron and cut grass. Everything in that half-lit hour seemed to lean slightly toward what came next, as though the world were a sentence with its ending withheld.\n\nThe path narrowed where the hedges had grown untended, and the walking slowed to accommodate it. There was a gate at the end, and beyond the gate a field, and beyond the field the low grey shoulder of the hills. None of it had changed. That was the strange part — that so much could happen and the land would simply go on holding its shape.",

  "For a while nothing happened, and the nothing had a texture to it: the hum of a lamp, the tick of cooling metal, the small settlings of a building adjusting to the temperature of the dark. Time did not pass so much as accumulate, like snow against a door.\n\nThen a sound — soft, deliberate, unmistakably made by a hand. The kind of sound that reorganizes a room around itself. Every ordinary object took on the alertness of a held breath: the chair, the unwashed cup, the coat hung over the back of it. Whatever came next would divide the evening cleanly into before and after, and there was still, for one more second, a before.",

  "The plan had been agreed twice, once in daylight and once again in the dark, and it had sounded different both times. Now, with the hour arrived, it sounded like neither — only like a thing that would either work or it would not, and the not was easier to imagine.\n\nThe corridor smelled of cold stone and old smoke. A lamp guttered near the far end, throwing shadows that swung and steadied and swung again. Somewhere behind, a door was closed with more care than force. Counting helped: one step, then another, then the small eternity of the third. By the fourth the fear had become almost companionable, a weight carried rather than a hand at the throat.",

  "Snow began without ceremony, a few flakes drifting past the window and then, quite suddenly, all of it at once. The far end of the street went soft and then vanished, and the lamps stood in their own small rooms of light. It was the kind of weather that makes a promise it has no intention of keeping.\n\nInside, the fire had burned down to a red argument among the coals. There was tea gone cold on the table and a chair pulled out and never pushed back. The quiet had the particular quality of a held note. Whatever was going to be said next had been waiting a long time, and the snow, falling harder now, seemed content to wait a little longer.",

  "Morning arrived with the flat, honest light of a day that intends to be long. The road ahead ran straight for a mile and then thought better of it, bending out of sight behind a stand of trees whose names nobody had ever needed. Birds went up from the field in one motion and came down again farther off.\n\nThere was work to be done and no particular hurry to begin it. Still, the mind kept circling the same small stone: a word said too quickly, a look that had not been returned. Some things go unresolved simply because resolving them would mean saying them out loud, and a morning like that one offered every excuse not to.",

  "The door stood open on a room that had clearly been left rather than departed from. Papers lay where the draught had taken them. A window had been raised a hand's width, and the curtain moved in and out with the slow rhythm of something breathing in its sleep.\n\nNothing valuable appeared to be missing, which was worse than if something had been; absence has a way of asking better questions than theft does. The floor gave once underfoot and then held. Outside, far off, a bell counted out an hour that seemed to belong to another day entirely, and the sound of it went on longer than it should have, thinning into the trees.",
]

/**
 * Deterministic chunker: greedy groups of `wordsPerChunk` whitespace-delimited
 * words with all original whitespace (including "\n\n") preserved, so that
 * `chunkText(t).join("") === t` for every input.
 */
export function chunkText(text: string, wordsPerChunk = 3): string[] {
  const perChunk = Math.max(1, Math.floor(wordsPerChunk))
  const chunks: string[] = []
  const tokens = text.match(/\s+|\S+/g)
  if (!tokens) return chunks

  let buffer = ""
  let words = 0
  for (const token of tokens) {
    buffer += token
    if (!/^\s/.test(token)) {
      words += 1
      if (words === perChunk) {
        chunks.push(buffer)
        buffer = ""
        words = 0
      }
    }
  }
  if (buffer !== "") chunks.push(buffer)
  return chunks
}
