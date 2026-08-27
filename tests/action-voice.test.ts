// tests/action-voice.test.ts — The specification for translateAction, in
// the only form that survives a refactor. Every case is a table row of
// [input, expected output]; the rows marked ACCEPTED pin behaviour we know is
// linguistically wrong and have chosen to keep, so that a later reader can tell
// a deliberate limit from a regression before "fixing" it.

import { describe, expect, test } from "bun:test"
import { translateAction } from "@/lib/story/action-voice"

type Case = readonly [input: string, expected: string]

const DO_CASES: readonly Case[] = [
  // Empty-ish input: the composer relies on "" meaning "nothing to submit".
  ["", ""],
  ["   ", ""],
  ["\n", ""],
  ["\n  \n", ""],

  // The contract's own examples.
  ["open the cellar door", "You open the cellar door."],
  [
    "I shove the door with my shoulder",
    "You shove the door with your shoulder.",
  ],
  ["I am not going in there", "You are not going in there."],
  [
    'I tell her, "I\'m not leaving without my sister"',
    'You tell her, "I\'m not leaving without my sister."',
  ],

  // Pronouns, case preservation, and the be-only agreement pass.
  ["i wait", "You wait."],
  ["I was afraid of the dark", "You were afraid of the dark."],
  // Agreement survives an adverb between the pronoun and the verb…
  ["I still am not sure", "You still are not sure."],
  ["I really am done", "You really are done."],
  ["I never was any good at this", "You never were any good at this."],
  // …but must not reach across a clause into someone else's verb.
  ["I run and the guard was there", "You run and the guard was there."],
  ["I HAVE THE KEY", "You HAVE THE KEY."],
  ["I pull myself up", "You pull yourself up."],
  ["I claim what is mine", "You claim what is yours."],
  ["I return to our camp", "You return to your camp."],
  ["I follow the tracks", "You follow the tracks."],
  ["I'd rather not touch it", "You'd rather not touch it."],
  ["I've seen this room before", "You've seen this room before."],
  ["I'll wait here", "You'll wait here."],

  // Curly apostrophes: writers paste them constantly.
  ["I’m ready", "You're ready."],
  ["I’ve been here before", "You've been here before."],
  ["we’re leaving", "You're leaving."],

  // "mine" is only a pronoun when no determiner precedes it — adjectives
  // between the two do not change that, but any closed-class word (a verb of
  // being, a preposition, a conjunction) breaks the noun phrase and does.
  ["I climb down into the mine", "You climb down into the mine."],
  [
    "I climb down into the old flooded mine",
    "You climb down into the old flooded mine.",
  ],
  ["I sweep out my old mine", "You sweep out your old mine."],
  ["the key is mine", "You the key is yours."],
  ["the city will be mine", "You the city will be yours."],
  ["the sword becomes mine", "You the sword becomes yours."],
  ["that makes it mine", "You that makes it yours."],
  ["the horse is a friend of mine", "You the horse is a friend of yours."],
  ["her blade is the same as mine", "You her blade is the same as yours."],
  ["I compare the map with mine", "You compare the map with yours."],
  [
    "I hand her the coat and grab mine",
    "You hand her the coat and grab yours.",
  ],
  // ACCEPTED: an open-class verb between the determiner and "mine" cannot be
  // listed, so the guard still reads this "mine" as a noun and leaves it.
  ["the guard drops mine", "You the guard drops mine."],

  // Quotations are masked, so the dialogue inside keeps its first person.
  ['I say, "I will find my sister"', 'You say, "I will find my sister."'],
  ["I shout “stay back” at the guard", "You shout “stay back” at the guard."],

  // Terminal punctuation the writer already supplied is left alone.
  ["I run!", "You run!"],
  ["I hesitate…", "You hesitate…"],
  // "I" is capitalised wherever it stands, so its case cannot be copied onto
  // the replacement — a second one mid-sentence must not become "You".
  [
    "I kick a rock feeling bored as I walk through the trees",
    "You kick a rock feeling bored as you walk through the trees.",
  ],
  [
    "I open the door before I lose my nerve",
    "You open the door before you lose your nerve.",
  ],
  [
    "I wait until I'm sure the hall is empty",
    "You wait until you're sure the hall is empty.",
  ],
  [
    "I run because I've seen what it does",
    "You run because you've seen what it does.",
  ],
  [
    "I duck low and I'll circle around the back",
    "You duck low and you'll circle around the back.",
  ],
  [
    "I stop, and I'd rather not go further",
    "You stop, and you'd rather not go further.",
  ],
  ["I hide because I’m afraid", "You hide because you're afraid."],
  // A shouted first person is still shouted: ALL CAPS says something about the
  // writer's intent where a lone initial capital on "I" does not.
  ["I scream because I'VE HAD ENOUGH", "You scream because YOU'VE HAD ENOUGH."],
  ["do I dare?", "You do you dare?"],

  // Input that already speaks in the second person is not prefixed twice.
  ["You open the door", "You open the door."],
  ["you open the door", "You open the door."],

  // A turn is one paragraph, so newlines become spaces.
  ["I open the door\nand step through", "You open the door and step through."],

  // ACCEPTED: no subject detection. A third-party subject gets the naive
  // prefix rather than a guess, and "me" still flips to "you".
  ["the guard turns around", "You the guard turns around."],
  ["the guard hands me the key", "You the guard hands you the key."],

  // ACCEPTED: only the first sentence of a multi-sentence Do is prefixed, and
  // only the first letter of the whole turn is capitalised.
  ["open the door. step inside", "You open the door. step inside."],
  // …but an "I" that opens a later sentence keeps its capital, because there
  // the capital really is positional.
  ["I open the door. I step inside", "You open the door. You step inside."],
  ["I freeze! I'm not ready", "You freeze! You're not ready."],
  ["I run. and I hide", "You run. and you hide."],

  // ACCEPTED: "we" collapses companions into the single second-person "you".
  ["we run for the door", "You run for the door."],
  ["We run for the door", "You run for the door."],
  ["we brace ourselves", "You brace yourself."],
  ["Us two head for the stairs", "You two head for the stairs."],

  // "us" and "we" are skipped in ALL CAPS only, which spares the initialism
  // "US"; ACCEPTED: a shouted "WE" is spared with it.
  ["the US embassy is burning", "You the US embassy is burning."],
  ["WE ARE LEAVING", "You WE ARE LEAVING."],
]

const SAY_CASES: readonly Case[] = [
  ["", ""],
  ["   ", ""],
  ["\n", ""],

  // The contract's own examples.
  ["who's down there?", 'You say, "Who\'s down there?"'],
  [
    "i tell her I'm not leaving without my sister",
    'You say, "I\'m not leaving without my sister."',
  ],

  // Quotes the writer typed around the line are ours to re-add.
  ['"get back"', 'You say, "Get back."'],
  ["“hello?”", 'You say, "Hello?"'],
  ['""', ""],
  ['I shout, "get out of the house"', 'You say, "Get out of the house."'],

  // Preamble stripping, with each of the delimiters.
  ["I say, hello", 'You say, "Hello."'],
  ["I whisper: don't move", 'You say, "Don\'t move."'],
  ["I answer — not tonight", 'You say, "Not tonight."'],
  ["I reply - not tonight", 'You say, "Not tonight."'],
  ["I ask her, why did you come back?", 'You say, "Why did you come back?"'],
  ["I tell him that we should leave", 'You say, "We should leave."'],
  ["I say that we should leave", 'You say, "We should leave."'],
  ["we ask the guard where the stairs are", 'You say, "Where the stairs are."'],

  // An unpunctuated speech verb with no addressee and no "that" is a line, not
  // a preamble: stripping it would delete words the writer meant to speak.
  ["I told you so", 'You say, "I told you so."'],
  ["I said nothing", 'You say, "I said nothing."'],
  ["i say nothing moved", 'You say, "I say nothing moved."'],
  ["I answer to no one", 'You say, "I answer to no one."'],
  // ACCEPTED: an addressee *is* enough to strip, so a verb-plus-object line
  // loses its first words. Telling this apart from "I tell her I'm not
  // leaving" needs a parser.
  ["I call him a liar", 'You say, "A liar."'],

  // Straight quotes inside the line are curled so they cannot close the
  // wrapper the rendering adds.
  ['she called it a "gift"', 'You say, "She called it a “gift.”"'],
  ['he said "no" and walked out', 'You say, "He said “no” and walked out."'],

  // Nothing that looks like a preamble is left alone.
  [
    "I'm not leaving without my sister",
    'You say, "I\'m not leaving without my sister."',
  ],
  [
    "nobody told me about the cellar",
    'You say, "Nobody told me about the cellar."',
  ],

  // A "preamble" with no line after it is not a preamble.
  ["I shout:", 'You say, "I shout:."'],

  // Punctuation and capitalisation.
  ["get out!", 'You say, "Get out!"'],
  ["fine…", 'You say, "Fine…"'],
  ["hello\nthere", 'You say, "Hello there."'],
  ["it’s locked", 'You say, "It’s locked."'],

  // ACCEPTED — and the load-bearing asymmetry with Do: Say never rewrites
  // pronouns, because the player character is the speaker and a speaker says
  // "I". These rows would all be wrong if someone "fixed" that.
  ["I am not going in there", 'You say, "I am not going in there."'],
  [
    "my sister is still down there",
    'You say, "My sister is still down there."',
  ],
  ["give me the lamp", 'You say, "Give me the lamp."'],

  // ACCEPTED: the speech verb and its adverb are discarded, so manner is lost.
  ["I whisper urgently: don't move", 'You say, "Don\'t move."'],
  ["I scream at him, run", 'You say, "Run."'],
]

describe("translateAction — do", () => {
  for (const [input, expected] of DO_CASES) {
    test(JSON.stringify(input), () => {
      expect(translateAction("do", input)).toBe(expected)
    })
  }
})

describe("translateAction — say", () => {
  for (const [input, expected] of SAY_CASES) {
    test(JSON.stringify(input), () => {
      expect(translateAction("say", input)).toBe(expected)
    })
  }
})

describe("translateAction — invariants", () => {
  test("is pure: the same input translates identically every time", () => {
    const input = "I shove the door with my shoulder"
    expect(translateAction("do", input)).toBe(translateAction("do", input))
  })

  test("is idempotent enough to re-run on its own output", () => {
    const once = translateAction("do", "I open the cellar door")
    expect(translateAction("do", once)).toBe(once)
  })
})
