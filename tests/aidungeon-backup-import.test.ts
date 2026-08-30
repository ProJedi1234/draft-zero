// tests/aidungeon-backup-import.test.ts — What an AI Dungeon backup is allowed
// to turn into.
//
// The card reader (aidungeon-import.test.ts) risks a lorebook. This one risks a
// manuscript: a backup is the only import that writes hundreds of passages, and
// every way it can go wrong is quiet and permanent. A `continue` filed as
// `source: "user"` makes the model's own prose look like the writer's. A player
// turn that keeps AI Dungeon's "> " gets a second chevron at prompt time. An
// `actions-10.json` sorted between 1 and 2 reorders the middle of an adventure
// with nothing on the page to show for it. None of those throw.
//
// So the assertions are on exact values — the passage array in order, the
// source of each row, the reconstructed `inputText` beside the prose it
// produced. And the real archive is a real archive: tests/fixtures is the zip
// AI Dungeon wrote, deflate and all, because a hand-built stand-in would only
// ever prove the reader can read what these tests know how to write.

import { describe, expect, test } from "bun:test"

import { parseBackup } from "@/lib/import/aidungeon-backup"

import { buildZip, type ZipFiles } from "./helpers/zip"

const SAMPLE_PATH = new URL("./fixtures/aidungeon-backup.zip", import.meta.url)
  .pathname

async function sampleBytes(): Promise<Uint8Array> {
  return new Uint8Array(await Bun.file(SAMPLE_PATH).arrayBuffer())
}

/** Unwraps a parse that is expected to succeed, failing loudly if it didn't. */
async function parsed(input: Uint8Array) {
  const result = await parseBackup(input)
  if (!result.ok) throw new Error(`expected a parse, got: ${result.error}`)
  return result.data
}

/** A metadata.json carrying only what the test cares about. */
function metadata(overrides: {
  adventure?: Record<string, unknown>
  state?: Record<string, unknown>
  totalActionCount?: number
  totalParts?: number
}): string {
  return JSON.stringify({
    exportedAt: "2026-08-30T01:17:00.000Z",
    adventure: { title: "An Adventure", ...overrides.adventure },
    state: { type: "adventure", storyCards: [], ...overrides.state },
    totalActionCount: overrides.totalActionCount,
    totalParts: overrides.totalParts,
  })
}

/** An actions-NNN.json carrying the given actions verbatim. */
function actions(...list: { type: string; text: string }[]): string {
  return JSON.stringify({
    partNumber: 1,
    totalParts: 1,
    actions: list.map((action, index) => ({ id: String(index), ...action })),
  })
}

function archive(files: ZipFiles): Uint8Array {
  return buildZip(files)
}

// ---------------------------------------------------------------------------

describe("the real archive", () => {
  test("reads the adventure AI Dungeon exported", async () => {
    const backup = await parsed(await sampleBytes())

    expect(backup.title).toBe("Modern Fantasy (World Scenario): Zach")
    expect(backup.tags).toEqual([
      "fantasy",
      "modern",
      "slice of life",
      "city",
      "elf",
      "dwarf",
      "orc",
      "race",
      "discrimination",
      "society",
    ])
    expect(backup.authorsNote).toBe(
      "Writing style: Elegant, dramatic, vivid prose. Theme: fantasy, slice of life, modernity, city, racism."
    )
    // 56 story cards, and not one of them a worldDescription — this adventure
    // keeps its setting in the memory field instead.
    expect(backup.lorebookEntries).toHaveLength(56)
    expect(backup.settingEntries).toHaveLength(0)
    expect(backup.worldDescription).toBe("")
    expect(backup.warnings).toEqual([])
  })

  test("keeps the memory's stat block on its own lines", async () => {
    const backup = await parsed(await sampleBytes())

    // NOT the paragraph contract. Memory reaches the model verbatim inside a
    // [Memory] block, and promoting every newline would blank-line each row of
    // this apart — the same failure toLoreText exists to prevent for lore.
    expect(backup.memory).toContain("Name: Zach\nGender: male")
  })

  test("puts the opening on the page and the model's turn after it", async () => {
    const backup = await parsed(await sampleBytes())

    expect(backup.passages).toHaveLength(2)
    expect(backup.passages[0].source).toBe("user")
    expect(backup.passages[0].actionKind).toBeNull()
    expect(backup.passages[0].text).toStartWith("The kingdom of Larion")
    // A `continue` is the model's, and filing it as the writer's would put
    // someone else's name on it in the manuscript and in every retry.
    expect(backup.passages[1].source).toBe("generated")
    expect(backup.passages[1].actionKind).toBeNull()
  })

  test("normalizes the opening to the paragraph contract", async () => {
    const backup = await parsed(await sampleBytes())

    // AI Dungeon writes hard breaks as single newlines and leaves trailing
    // ones behind; the canvas splits on "\n\n" and renders nothing else.
    expect(backup.passages[0].text).not.toContain("\n\n\n")
    expect(backup.passages[0].text.endsWith("\n")).toBe(false)
    expect(backup.passages[0].text).toContain("\n\n")
  })
})

describe("action types", () => {
  test("a Do keeps its prose and comes back re-editable", async () => {
    const backup = await parsed(
      archive({
        "metadata.json": metadata({}),
        "actions-001.json": actions({
          type: "do",
          text: "\n> You open the door.\n",
        }),
      })
    )

    expect(backup.passages).toEqual([
      {
        source: "user",
        // The chevron is GONE. draft-zero adds its own from action_kind at
        // prompt time, so a stored one is doubled on the page and in context.
        text: "You open the door.",
        actionKind: "do",
        inputText: "You open the door.",
      },
    ])
  })

  test("a Say is unwrapped back to the line that was spoken", async () => {
    const backup = await parsed(
      archive({
        "metadata.json": metadata({}),
        "actions-001.json": actions({
          type: "say",
          text: '\n> You say "Get out."\n',
        }),
      })
    )

    // inputText is what the writer would have typed, not what AI Dungeon
    // rendered: feeding the rendering back through the Say translation gives
    // You say, "You say "get out."" — the narrator quoting the narrator.
    expect(backup.passages).toEqual([
      {
        source: "user",
        text: 'You say, "Get out."',
        actionKind: "say",
        inputText: "Get out.",
      },
    ])
  })

  test("a Say that doesn't match the rendering is kept whole", async () => {
    const backup = await parsed(
      archive({
        "metadata.json": metadata({}),
        "actions-001.json": actions({ type: "say", text: "> Hello there" }),
      })
    )

    expect(backup.passages[0].actionKind).toBe("say")
    expect(backup.passages[0].inputText).toBe("Hello there")
    expect(backup.passages[0].text).toBe('You say, "Hello there."')
  })

  test("`story` is the writer's own prose, not a turn", async () => {
    const backup = await parsed(
      archive({
        "metadata.json": metadata({}),
        "actions-001.json": actions({
          type: "story",
          text: "Rain fell on the platform.",
        }),
      })
    )

    // No chevron at prompt time and no Say/Do editor: this is narration the
    // writer typed straight into the manuscript, which is exactly what a null
    // action_kind means.
    expect(backup.passages).toEqual([
      {
        source: "user",
        text: "Rain fell on the platform.",
        actionKind: null,
        inputText: null,
      },
    ])
  })

  test("an image beat is dropped, and said to be dropped", async () => {
    const backup = await parsed(
      archive({
        "metadata.json": metadata({}),
        "actions-001.json": actions(
          { type: "story", text: "A door." },
          { type: "see", text: "a photo of a door" }
        ),
      })
    )

    expect(backup.passages).toHaveLength(1)
    expect(backup.warnings).toContain(
      "Dropped 1 image — a backup carries the prompt but not the picture."
    )
  })

  test("an unknown type becomes narration, and is named", async () => {
    const backup = await parsed(
      archive({
        "metadata.json": metadata({}),
        "actions-001.json": actions({ type: "wager", text: "You bet it all." }),
      })
    )

    expect(backup.passages[0].actionKind).toBeNull()
    expect(backup.passages[0].text).toBe("You bet it all.")
    expect(backup.warnings).toContain(
      "Unrecognised action type (wager) was imported as narration."
    )
  })

  test("blank actions are skipped rather than left as empty passages", async () => {
    const backup = await parsed(
      archive({
        "metadata.json": metadata({}),
        "actions-001.json": actions(
          { type: "story", text: "Kept." },
          { type: "continue", text: "   \n  " }
        ),
      })
    )

    expect(backup.passages).toHaveLength(1)
    expect(backup.warnings).toContain("Skipped 1 empty action.")
  })
})

describe("action parts", () => {
  test("are read in numeric order, not the archive's", async () => {
    const backup = await parsed(
      archive({
        "metadata.json": metadata({ totalParts: 3 }),
        // Deliberately out of order in the archive, and numbered past 9 so a
        // string sort would put part 10 between 1 and 2.
        "actions-010.json": actions({ type: "story", text: "Third." }),
        "actions-002.json": actions({ type: "story", text: "Second." }),
        "actions-001.json": actions({ type: "story", text: "First." }),
      })
    )

    expect(backup.passages.map((passage) => passage.text)).toEqual([
      "First.",
      "Second.",
      "Third.",
    ])
  })

  test("a missing part is reported rather than silently skipped", async () => {
    const backup = await parsed(
      archive({
        "metadata.json": metadata({ totalParts: 2, totalActionCount: 2 }),
        "actions-001.json": actions({ type: "story", text: "First." }),
      })
    )

    expect(backup.warnings).toContain(
      "This backup says it has 2 action files but only 1 is in the zip."
    )
    expect(backup.warnings).toContain(
      "This backup says it has 2 actions but 1 arrived."
    )
  })

  test("survive a re-zipped folder", async () => {
    const backup = await parsed(
      archive({
        "backup/metadata.json": metadata({}),
        "backup/actions-001.json": actions({ type: "story", text: "Here." }),
      })
    )

    expect(backup.passages).toHaveLength(1)
  })
})

describe("metadata", () => {
  test("memory is Plot Essentials, and the memories store is dropped", async () => {
    const backup = await parsed(
      archive({
        "metadata.json": metadata({
          adventure: { memory: "Zach is a lawyer." },
          state: { memories: [{ text: "Barnaby owes him a favour." }] },
        }),
        "actions-001.json": actions({ type: "story", text: "Here." }),
      })
    )

    // `adventure.memory` is Plot Essentials and maps 1:1. `state.memories` is
    // AI Dungeon's recall store, and appending it here would turn entries that
    // are meant to be RETRIEVED into standing context injected into every
    // prompt — the one property the store exists not to have.
    expect(backup.memory).toBe("Zach is a lawyer.")
    expect(backup.warnings).toContain(
      "Dropped 1 AI Dungeon memory — there's nothing here that remembers the way that store does."
    )
  })

  test("AI instructions replace the narrator prompt, not the memory", async () => {
    const backup = await parsed(
      archive({
        "metadata.json": metadata({
          adventure: { memory: "Zach is a lawyer." },
          state: { instructions: { custom: "Never break the fourth wall." } },
        }),
        "actions-001.json": actions({ type: "story", text: "Here." }),
      })
    )

    // AI Dungeon writes these as a system prompt and writers author them as
    // one. In memory they would read as a fact about the world instead of as
    // an instruction to the narrator.
    expect(backup.instructions).toBe("Never break the fourth wall.")
    expect(backup.memory).toBe("Zach is a lawyer.")
    expect(backup.warnings).toContain(
      "The adventure's AI instructions replace the built-in narrator prompt — edit it under Narrator."
    )
  })

  test("`scenario` instructions stand in when there is no custom set", async () => {
    const backup = await parsed(
      archive({
        "metadata.json": metadata({
          state: {
            instructions: { type: null, custom: null, scenario: "Be terse." },
          },
        }),
        "actions-001.json": actions({ type: "story", text: "Here." }),
      })
    )

    expect(backup.instructions).toBe("Be terse.")
  })

  test("an adventure with no instructions keeps the built-in prompt", async () => {
    const backup = await parsed(
      archive({
        "metadata.json": metadata({
          state: { instructions: { type: null, custom: null, scenario: "" } },
        }),
        "actions-001.json": actions({ type: "story", text: "Here." }),
      })
    )

    // Empty, so the action writes NULL and the story goes on following
    // DEFAULT_SYSTEM_PROMPT as that text changes.
    expect(backup.instructions).toBe("")
    expect(backup.warnings).toEqual([])
  })

  test("the rolling summary comes back on its own", async () => {
    const backup = await parsed(
      archive({
        "metadata.json": metadata({
          state: { storySummary: "Zach missed his train." },
        }),
        "actions-001.json": actions({ type: "story", text: "Here." }),
      })
    )

    // Kept out of memory: the action writes it as the story's first recap
    // version, which is the same object our summarizer produces.
    expect(backup.summary).toBe("Zach missed his train.")
    expect(backup.memory).toBe("")
  })
})

describe("rejections", () => {
  test("a zip that isn't a backup isn't claimed", async () => {
    const result = await parseBackup(archive({ "notes.txt": "hello" }))

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.recognised).toBe(false)
    expect(result.error).toContain("metadata.json")
  })

  test("a backup with broken metadata IS claimed", async () => {
    const result = await parseBackup(archive({ "metadata.json": "{oops" }))

    expect(result.ok).toBe(false)
    if (result.ok) return
    // Recognised, so the picker reports this instead of falling through to a
    // reader that would reject it for some unrelated reason.
    expect(result.recognised).toBe(true)
  })

  test("an adventure with nothing in it is refused", async () => {
    const result = await parseBackup(
      archive({ "metadata.json": metadata({}), "actions-001.json": actions() })
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.recognised).toBe(true)
    expect(result.error).toBe(
      "That backup has no story and no story cards in it."
    )
  })

  test("something that isn't a zip at all", async () => {
    const result = await parseBackup(new TextEncoder().encode("{}"))

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.recognised).toBe(false)
  })
})
