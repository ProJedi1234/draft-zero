// lib/mock-data.ts — Hardcoded fixture data for the static-scaffolding milestone.
// Nothing here persists; nothing here calls a network.

import type {
  GenerationSettings,
  LorebookCategory,
  LorebookEntry,
  OpenRouterModel,
  Story,
} from "./types"

// ---------------------------------------------------------------------------
// Models (OpenRouter stubs)
// ---------------------------------------------------------------------------

export const MOCK_MODELS: OpenRouterModel[] = [
  {
    id: "anthropic/claude-sonnet-4.5",
    name: "Claude Sonnet 4.5",
    provider: "Anthropic",
    contextLength: 1_000_000,
    pricing: { prompt: "$3.00", completion: "$15.00" },
    reasoning: { efforts: ["low", "medium", "high"], mandatory: false },
  },
  {
    id: "anthropic/claude-opus-4.5",
    name: "Claude Opus 4.5",
    provider: "Anthropic",
    contextLength: 200_000,
    pricing: { prompt: "$5.00", completion: "$25.00" },
    reasoning: { efforts: ["low", "medium", "high"], mandatory: false },
  },
  {
    id: "openai/gpt-5.1",
    name: "GPT-5.1",
    provider: "OpenAI",
    contextLength: 400_000,
    pricing: { prompt: "$1.25", completion: "$10.00" },
    reasoning: {
      efforts: ["minimal", "low", "medium", "high", "xhigh"],
      mandatory: false,
    },
  },
  {
    id: "openai/gpt-5-mini",
    name: "GPT-5 Mini",
    provider: "OpenAI",
    contextLength: 400_000,
    pricing: { prompt: "$0.25", completion: "$2.00" },
    reasoning: {
      efforts: ["minimal", "low", "medium", "high"],
      mandatory: false,
    },
  },
  {
    id: "google/gemini-3-pro-preview",
    name: "Gemini 3 Pro",
    provider: "Google",
    contextLength: 1_000_000,
    pricing: { prompt: "$2.00", completion: "$12.00" },
    reasoning: { efforts: ["low", "high"], mandatory: true },
  },
  {
    id: "google/gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    provider: "Google",
    contextLength: 1_000_000,
    pricing: { prompt: "$0.30", completion: "$2.50" },
    reasoning: { efforts: ["low", "medium", "high"], mandatory: false },
  },
  {
    id: "meta-llama/llama-4-maverick",
    name: "Llama 4 Maverick",
    provider: "Meta",
    contextLength: 1_000_000,
    pricing: { prompt: "$0.20", completion: "$0.85" },
    reasoning: null,
  },
  {
    id: "deepseek/deepseek-v3.2",
    name: "DeepSeek V3.2",
    provider: "DeepSeek",
    contextLength: 131_072,
    pricing: { prompt: "$0.25", completion: "$0.40" },
    reasoning: { efforts: ["low", "high"], mandatory: false },
  },
  {
    id: "mistralai/mistral-medium-3",
    name: "Mistral Medium 3",
    provider: "Mistral",
    contextLength: 131_072,
    pricing: { prompt: "$0.40", completion: "$2.00" },
    reasoning: null,
  },
]

export const DEFAULT_GENERATION_SETTINGS: GenerationSettings = {
  modelId: "anthropic/claude-sonnet-4.5",
  thinking: "off",
  temperature: 0.9,
  topP: 0.95,
  // A hard ceiling on the runaway case, not a target. The system prompt asks
  // for a single paragraph; this is what stops a model that ignores it from
  // filling most of a page before the writer can reach Stop.
  maxTokens: 400,
  frequencyPenalty: 0.15,
  presencePenalty: 0.1,
}

// ---------------------------------------------------------------------------
// Lorebook — every fixture entry belongs to the Cartographer draft. Lore is
// scoped per story, so the other seeded stories start with an empty lorebook.
// ---------------------------------------------------------------------------

export const MOCK_LOREBOOK_ENTRIES: LorebookEntry[] = [
  {
    id: "lore-char-maren",
    storyId: "story-cartographer",
    name: "Maren Kestrel",
    category: "character",
    keys: ["Maren", "Kestrel", "the cartographer"],
    content:
      "Maren Kestrel, 34, is a licensed surveyor of the Graywater floodplain and an unlicensed cartographer of things that should not be mapped. Sharp-tongued, methodical, quietly terrified of open water. She owes the river god Elathe eleven maps' worth of debt and has never told the Guild why her surveys are always accurate.",
    enabled: true,
    alwaysActive: false,
    priority: 80,
    createdAt: "2026-06-02T09:00:00Z",
    updatedAt: "2026-08-01T17:20:00Z",
  },
  {
    id: "lore-char-oswin",
    storyId: "story-cartographer",
    name: "Oswin Pyke",
    category: "character",
    keys: ["Oswin", "Pyke", "ferryman"],
    content:
      "Oswin Pyke runs the last ferry across Graywater Crossing. Cheerful, missing two fingers, superstitious in the practical way of people who work on haunted water. He leaves a copper coin on the tiller for Elathe every crossing and pretends it is habit rather than payment.",
    enabled: true,
    alwaysActive: false,
    priority: 55,
    createdAt: "2026-06-02T09:15:00Z",
    updatedAt: "2026-07-18T11:05:00Z",
  },
  {
    id: "lore-char-elathe",
    storyId: "story-cartographer",
    name: "Elathe, the Ithren",
    category: "character",
    keys: ["Elathe", "river god", "the Ithren", "the river"],
    content:
      "Elathe is the god of the river Ithren: patient, contractual, and literal. It speaks through the water's surface and collects debts in maps, memories, and names. It cannot lie, but it curates truth ruthlessly. It considers Maren its finest investment.",
    enabled: true,
    alwaysActive: true,
    priority: 95,
    createdAt: "2026-06-02T09:30:00Z",
    updatedAt: "2026-08-05T08:40:00Z",
  },
  {
    id: "lore-loc-graywater",
    storyId: "story-cartographer",
    name: "Graywater Crossing",
    category: "location",
    keys: ["Graywater", "the Crossing"],
    content:
      "A stone causeway where the Ithren bends against its own current. The drowned quarter of the old city lies beneath it, visible on still mornings. Compasses fail here; the Guild marks it on official maps with a decorative flourish instead of soundings.",
    enabled: true,
    alwaysActive: false,
    priority: 70,
    createdAt: "2026-06-03T10:00:00Z",
    updatedAt: "2026-07-30T14:00:00Z",
  },
  {
    id: "lore-loc-saltmarket",
    storyId: "story-cartographer",
    name: "The Salt Market",
    category: "location",
    keys: ["Salt Market", "saltmarket"],
    content:
      "A covered market on the east bank where smugglers sell 'unmapped goods' — items that officially do not exist because no chart admits the places they came from. The Guild raids it quarterly, ceremonially, and finds nothing.",
    enabled: true,
    alwaysActive: false,
    priority: 40,
    createdAt: "2026-06-05T12:00:00Z",
    updatedAt: "2026-06-28T16:30:00Z",
  },
  {
    id: "lore-loc-undermap",
    storyId: "story-cartographer",
    name: "The Undermap Archive",
    category: "location",
    keys: ["Undermap", "archive"],
    content:
      "The Guild's sealed basement archive of withdrawn maps — charts that proved too true. Shelved in lead-lined cases, indexed by the disasters they predicted. Maren has been inside twice, once with permission.",
    enabled: true,
    alwaysActive: false,
    priority: 60,
    createdAt: "2026-06-10T09:00:00Z",
    updatedAt: "2026-07-02T10:10:00Z",
  },
  {
    id: "lore-faction-guild",
    storyId: "story-cartographer",
    name: "The Surveyors' Guild",
    category: "faction",
    keys: ["Guild", "surveyors"],
    content:
      "The licensing body for all cartography in the river provinces. Publicly a professional association; privately a containment agency that decides which places may be drawn. Guild law: 'A map is a promise. Do not promise carelessly.'",
    enabled: true,
    alwaysActive: false,
    priority: 65,
    createdAt: "2026-06-03T11:00:00Z",
    updatedAt: "2026-07-25T09:45:00Z",
  },
  {
    id: "lore-faction-drowned",
    storyId: "story-cartographer",
    name: "Court of the Drowned",
    category: "faction",
    keys: ["Drowned", "the Court"],
    content:
      "The dead of the sunken quarter, who still hold municipal grudges and, arguably, municipal office. They petition Elathe for the return of their streets. Currently disabled while their role in act two is rethought.",
    enabled: false,
    alwaysActive: false,
    priority: 30,
    createdAt: "2026-06-12T15:00:00Z",
    updatedAt: "2026-07-12T15:00:00Z",
  },
  {
    id: "lore-item-needle",
    storyId: "story-cartographer",
    name: "The Bone Needle",
    category: "item",
    keys: ["bone needle", "needle", "compass"],
    content:
      "A compass needle carved from the wing-bone of a river heron. It does not point north; it points toward whatever the Ithren wants found. Warm to the touch when the river is watching. Maren keeps it wrapped in oilcloth and lies to herself about why.",
    enabled: true,
    alwaysActive: false,
    priority: 75,
    createdAt: "2026-06-04T08:00:00Z",
    updatedAt: "2026-08-03T19:00:00Z",
  },
  {
    id: "lore-event-flood",
    storyId: "story-cartographer",
    name: "The Third Flood",
    category: "event",
    keys: ["Third Flood", "the flood"],
    content:
      "Forty years ago the Ithren rose without rain and took the lower city in a night. Official history calls it a natural disaster. The Guild's withdrawn charts, shelved in the Undermap, show the flood line drawn in ink dated three days before the water came.",
    enabled: true,
    alwaysActive: false,
    priority: 50,
    createdAt: "2026-06-06T10:00:00Z",
    updatedAt: "2026-07-08T13:20:00Z",
  },
  {
    id: "lore-concept-debt",
    storyId: "story-cartographer",
    name: "Cartographer's Debt",
    category: "concept",
    keys: ["debt", "twelfth map", "payment"],
    content:
      "Maps drawn with Elathe's help come true — and each one is a loan. The debt is repaid in maps the river commissions, and the river's commissions are never innocent. Maren owes one final map: the twelfth, a chart of the drowned quarter as it was the night it sank.",
    enabled: true,
    alwaysActive: true,
    priority: 90,
    createdAt: "2026-06-02T09:45:00Z",
    updatedAt: "2026-08-06T21:00:00Z",
  },
]

// ---------------------------------------------------------------------------
// Stories
// ---------------------------------------------------------------------------

export const MOCK_STORIES: Story[] = [
  {
    id: "story-cartographer",
    title: "The Cartographer's Debt",
    description:
      "A surveyor who draws maps that come true owes one last chart to the river god that taught her how.",
    genre: "Fantasy",
    createdAt: "2026-06-02T08:30:00Z",
    updatedAt: "2026-08-09T21:15:00Z",
    wordCount: 436,
    memory:
      "Maren Kestrel is a Guild-licensed surveyor whose maps come true because the river god Elathe guides her hand. She owes Elathe a twelfth and final map: the drowned quarter as it was the night it sank. Tone: literary fantasy, wry, melancholy. Third person past, close on Maren.",
    systemPrompt: null,
    authorsNote:
      "Keep the river's dialogue literal and contractual. Never let Elathe lie.",
    activeLorebookEntryIds: [
      "lore-char-maren",
      "lore-char-elathe",
      "lore-loc-graywater",
      "lore-item-needle",
      "lore-concept-debt",
    ],
    settings: {
      modelId: "anthropic/claude-sonnet-4.5",
      thinking: "off",
      temperature: 0.9,
      topP: 0.95,
      maxTokens: 1024,
      frequencyPenalty: 0.15,
      presencePenalty: 0.1,
    },
    entries: [
      {
        id: "entry-cart-1",
        source: "generated",
        createdAt: "2026-06-02T08:45:00Z",
        text: 'The river had been lying to maps for three hundred years, and Maren Kestrel was the first cartographer honest enough to write the lies down. She stood on the stone lip of Graywater Crossing with her drafting board strapped to her chest, watching the Ithren bend a way no river should bend — uphill, against its own current, toward the drowned quarter of the old city.\n\nHer Guild license said she surveyed floodplains. Her private ledger said something truer: eleven maps drawn, eleven debts accrued, one river god growing impatient.\n\n"You\'re late," said the water.',
      },
      {
        id: "entry-cart-2",
        source: "user",
        createdAt: "2026-06-02T09:10:00Z",
        text: 'Maren set down her board and unwrapped the bone needle from its oilcloth. It swung once, twice, and settled — pointing not north but down, through the causeway stone, toward whatever the Ithren kept beneath the crossing. "I brought your payment," she said, and hated how small her voice sounded over the water.',
      },
      {
        id: "entry-cart-3",
        source: "generated",
        createdAt: "2026-06-02T09:12:00Z",
        text: 'The current folded in on itself, and out of the fold rose a shape that was mostly suggestion: a figure of green glass water, tall as a mast, wearing the surface of the river like a borrowed coat. Elathe did not have a face. It had, instead, a place where attention gathered, and all of it gathered now on the oilcloth in her hands.\n\n"Payment," the god repeated, in a voice like a lock turning. "You use that word the way drowning men use the word \'swimming.\' Show me the twelfth map, Maren Kestrel."',
      },
      {
        id: "entry-cart-4",
        source: "user",
        createdAt: "2026-06-02T09:30:00Z",
        text: "\"It isn't finished.\" The lie came out smooth, practiced. The map was finished. It had been finished for a month, rolled inside her chimney where the damp couldn't reach, and every night since she had dreamed of the streets it showed — streets full of people who did not yet know they were about to be dead.",
      },
      {
        id: "entry-cart-5",
        source: "generated",
        createdAt: "2026-06-02T09:32:00Z",
        text: 'The river went still. Not calm — still, the way a courtroom goes still. Along the whole length of the crossing the water stopped moving, and in that stillness Maren could see straight down through forty feet of green light to the drowned quarter: slate roofs furred with weed, a bell tower, a market square where pale shapes drifted between the stalls in an unhurried parody of errands.\n\n"Cartographer," Elathe said softly, "I taught you to draw true things. I did not teach you to say false ones. We will both pretend that mercy is why I let that pass."',
      },
    ],
  },
  {
    id: "story-static",
    title: "Static Between Stars",
    description:
      "A salvage crew answers a distress call from a colony ship that went silent sixty years ago — and finds the broadcast is still being made.",
    genre: "Science Fiction",
    createdAt: "2026-07-14T19:00:00Z",
    updatedAt: "2026-08-07T23:40:00Z",
    wordCount: 328,
    memory:
      "The salvage tug Magpie (crew: Ade Osei, pilot; Rhys, engineer; the narrator, comms) has intercepted a distress loop from the colony ship Meridian, lost 60 years ago. The loop's timestamp updates every day. Tone: quiet dread, hard-SF texture. First person present.",
    systemPrompt: null,
    authorsNote: "Slow burn. Horror through procedure and radio protocol, not gore.",
    activeLorebookEntryIds: [],
    settings: {
      modelId: "openai/gpt-5.1",
      thinking: "off",
      temperature: 1.1,
      topP: 0.9,
      maxTokens: 800,
      frequencyPenalty: 0.3,
      presencePenalty: 0.2,
    },
    entries: [
      {
        id: "entry-static-1",
        source: "generated",
        createdAt: "2026-07-14T19:20:00Z",
        text: "The distress call is sixty years old and four hours new. I keep both facts on my screen because one of them has to be wrong, and so far neither of them will admit it.\n\nMagpie hangs at station-keeping two thousand klicks off the Meridian's hull, close enough that our floodlights catch the colony ship's name in flaking paint. Every twenty-six hours her transmitter wakes, sends the same forty-one seconds of audio, and stamps it with the current date. Ships do not do that. Dead ships especially do not do that.",
      },
      {
        id: "entry-static-2",
        source: "user",
        createdAt: "2026-07-15T08:05:00Z",
        text: "Ade wants to board her. Rhys wants to log the contact and burn for home, and for once I think the engineer has the better physics. But salvage law is salvage law: first crew to make hull contact owns the claim, and the Meridian is the richest wreck in three systems.\n\nI put the forty-one seconds on the cabin speakers one more time.",
      },
      {
        id: "entry-static-3",
        source: "generated",
        createdAt: "2026-07-15T08:07:00Z",
        text: "It opens with the standard header, a woman's voice, calm the way only trained voices are calm: 'Colony vessel Meridian, requesting immediate assistance, one-one-eight souls aboard.' Then eleven seconds of station noise — air handlers, a child asking something far from the mic — and then the part I do not play for the others anymore.\n\nThe voice comes back. It is the same voice, but it has stopped being calm, and it says: 'Correction. One-one-nine souls aboard. Correction. One-two-zero.'\n\nThe count has gone up in every broadcast since we arrived.",
      },
      {
        id: "entry-static-4",
        source: "user",
        createdAt: "2026-07-16T22:00:00Z",
        text: "I flag the anomaly in the contact log, encrypt it, and do not tell Ade about the newest number. One hundred twenty-three. We are three people on this tug, and I have stopped believing in coincidence.",
      },
    ],
  },
  {
    id: "story-lighthouse",
    title: "The Lighthouse at Wren Point",
    description:
      "A grief-struck keeper takes the winter posting at a lighthouse whose last three keepers all resigned on the same date.",
    genre: "Mystery",
    createdAt: "2026-05-20T10:00:00Z",
    updatedAt: "2026-07-28T09:30:00Z",
    wordCount: 243,
    memory:
      "Esther Hale, recently widowed, has taken the winter keeper's post at Wren Point light. The previous three keepers each resigned on the 14th of February. The Trust's logbooks for that date are razored out. Tone: gothic, restrained. First person past, epistolary logbook entries.",
    systemPrompt: null,
    authorsNote: "Every scene should be explainable two ways until the final act.",
    activeLorebookEntryIds: [],
    settings: {
      modelId: "anthropic/claude-opus-4.5",
      thinking: "off",
      temperature: 0.8,
      topP: 0.98,
      maxTokens: 1200,
      frequencyPenalty: 0.1,
      presencePenalty: 0.05,
    },
    entries: [
      {
        id: "entry-light-1",
        source: "user",
        createdAt: "2026-05-20T10:30:00Z",
        text: "Log of the keeper, Wren Point Light. 3rd November.\n\nThe Trust's launch left me at the landing at noon with four months of tinned goods, a crate of lamp oil, and the strong impression that the boatman did not intend to cut the engine while I unloaded. The tower is sound. The light is sound. The logbook they gave me is new, which I thought nothing of until I found the old ones in the store room — nine volumes, complete, except that in each of them the same week of February has been cut out with a razor.",
      },
      {
        id: "entry-light-2",
        source: "generated",
        createdAt: "2026-05-20T10:33:00Z",
        text: "4th November.\n\nWind northwest, moderate. Lamp lit at 4:12, extinguished at 7:40. I record these details because the Trust requires them and because there is a comfort in requirements.\n\nOne matter I will set down plainly, since no one reads this but the Trust and the Trust does not read it either: the light was already warm when I climbed to light it. Not burning — warm. The brass of the lamp housing held heat the way a chair holds the shape of someone who has just stood up. I have decided to attribute it to the sun through the lens room glass, and I record here, honestly, that the sky was overcast all day.",
      },
      {
        id: "entry-light-3",
        source: "user",
        createdAt: "2026-05-21T09:00:00Z",
        text: "6th November.\n\nI have begun taking my supper in the lens room. Edward would have laughed at me — dining at the top of ninety-eight stairs for the company of a lamp. But the kitchen has a window that faces the sea, and the sea at dusk has started to look to me like it is standing very still on purpose.",
      },
    ],
  },
  {
    id: "story-untitled",
    title: "Untitled Story",
    description: "A brand-new draft. Nothing written yet.",
    genre: "Unsorted",
    createdAt: "2026-08-10T07:00:00Z",
    updatedAt: "2026-08-10T07:00:00Z",
    wordCount: 0,
    memory: "",
    systemPrompt: null,
    authorsNote: "",
    activeLorebookEntryIds: [],
    settings: { ...DEFAULT_GENERATION_SETTINGS },
    entries: [],
  },
]

export const DEFAULT_STORY_ID = "story-cartographer"

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

export function getStoryById(id: string): Story | undefined {
  return MOCK_STORIES.find((s) => s.id === id)
}

export function getModelById(id: string): OpenRouterModel | undefined {
  return MOCK_MODELS.find((m) => m.id === id)
}

export function getLorebookEntryById(id: string): LorebookEntry | undefined {
  return MOCK_LOREBOOK_ENTRIES.find((e) => e.id === id)
}

/** Enabled lorebook entries referenced by the story, in lorebook order. */
export function getActiveLorebookEntries(story: Story): LorebookEntry[] {
  return MOCK_LOREBOOK_ENTRIES.filter(
    (e) => e.enabled && story.activeLorebookEntryIds.includes(e.id)
  )
}

/** All entries (enabled and disabled) for a category, or all entries for "all". */
export function getLorebookEntriesByCategory(
  category: LorebookCategory | "all"
): LorebookEntry[] {
  if (category === "all") return MOCK_LOREBOOK_ENTRIES
  return MOCK_LOREBOOK_ENTRIES.filter((e) => e.category === category)
}
