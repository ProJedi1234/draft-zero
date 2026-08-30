"use client"

import * as React from "react"
import { Upload } from "lucide-react"
import { toast } from "sonner"

import {
  MAX_CARDS_BYTES,
  parseStoryCards,
  STORY_CARD_FILE_ACCEPT,
} from "@/lib/import/aidungeon"
import {
  BACKUP_FILE_ACCEPT,
  MAX_BACKUP_BYTES,
  parseBackup,
} from "@/lib/import/aidungeon-backup"
import {
  MAX_SCENARIO_BYTES,
  parseScenario,
  SCENARIO_FILE_ACCEPT,
} from "@/lib/import/novelai"
import { Button } from "@/components/ui/button"
import { SidebarGroupAction } from "@/components/ui/sidebar"
import {
  ImportBackupDialog,
  type PendingBackup,
} from "@/components/sidebar/import-backup-dialog"
import {
  ImportScenarioDialog,
  type PendingScenario,
} from "@/components/sidebar/import-scenario-dialog"
import {
  ImportStoryCardsDialog,
  type PendingStoryCards,
} from "@/components/sidebar/import-story-cards-dialog"

const LABEL = "Import story"

/** Every format, de-duplicated — two of the three are both .json. */
const FILE_ACCEPT = [
  ...new Set(
    `${SCENARIO_FILE_ACCEPT},${STORY_CARD_FILE_ACCEPT},${BACKUP_FILE_ACCEPT}`
      .split(",")
      .map((ext) => ext.trim())
  ),
].join(",")

// The format isn't known until the file is read, so the picker guards with the
// largest of the ceilings; each action re-checks its own.
const MAX_BYTES = Math.max(
  MAX_SCENARIO_BYTES,
  MAX_CARDS_BYTES,
  MAX_BACKUP_BYTES
)

/**
 * "PK\x03\x04" — a zip's local file header, and the only sniff that separates
 * the archive format from the two JSON ones.
 *
 * The magic bytes rather than the ".zip" extension: the picker also takes files
 * from mobile document providers, which routinely hand over a name with no
 * extension at all, and decoding an archive as UTF-8 to hunt for a `{` produces
 * mojibake rather than an error.
 */
function isZip(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  )
}

/**
 * Picks a NovelAI `.scenario`, an AI Dungeon story-card export or an AI Dungeon
 * backup archive, and opens the matching import confirmation.
 *
 * The writer never declares which format they have. An archive is sniffed by
 * its magic bytes and goes straight to the backup reader; the other two both
 * arrive as .json and recognise disjoint shapes — a card export is an array or
 * an object with a card list, a scenario is an object with a story prompt — so
 * the file is offered to each in turn and whichever one accepts it wins.
 *
 * The parse happens here purely to preview the file and to fail fast on
 * garbage; the actions re-read the same bytes server-side.
 */
export function ImportScenarioButton({
  variant = "group-action",
}: {
  /**
   * "group-action" is the sidebar's icon affordance, "button" a labelled one,
   * and "icon" the library header's — the same picker in three chromes.
   */
  variant?: "group-action" | "button" | "icon"
}) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [pendingScenario, setPendingScenario] =
    React.useState<PendingScenario | null>(null)
  const [pendingCards, setPendingCards] =
    React.useState<PendingStoryCards | null>(null)
  const [pendingBackup, setPendingBackup] =
    React.useState<PendingBackup | null>(null)

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // Reset first: picking the same file twice must fire `change` both times.
    event.target.value = ""
    if (!file) return

    if (file.size > MAX_BYTES) {
      toast.error("That file is too large to import.")
      return
    }

    // A picked file can still fail to read: it may live on a network or
    // removable volume, or have moved between the picker closing and this call,
    // which is routine on mobile document providers. Unguarded, the rejection
    // escapes the handler and the button simply appears dead.
    //
    // Read once, as bytes, and decode from those: a backup has to stay binary
    // and the JSON readers want text, and reading the file twice would give the
    // two halves of this handler different bytes if the file moved in between.
    let bytes: Uint8Array
    try {
      bytes = new Uint8Array(await file.arrayBuffer())
    } catch {
      toast.error("That file couldn't be read. Try picking it again.")
      return
    }

    if (isZip(bytes)) {
      const backup = await parseBackup(bytes)
      if (backup.ok) {
        // The File, not the bytes: the action takes the archive itself, and
        // handing it the same object avoids re-encoding a multi-megabyte body.
        setPendingBackup({ file, backup: backup.data })
        return
      }
      // No fallback to the JSON readers. Nothing that starts "PK\x03\x04" is
      // going to parse as either of them, and offering it to both would replace
      // the archive reader's real error with "that file isn't valid JSON".
      toast.error(backup.error)
      return
    }

    const json = new TextDecoder().decode(bytes)
    const cards = parseStoryCards(json)
    if (cards.ok) {
      setPendingCards({ json, cards: cards.data })
      return
    }

    // A card file that failed to READ is not offered to the scenario reader.
    // parseScenario accepts any object carrying a string `prompt`, so an AI
    // Dungeon scenario export whose card list is empty would sail through it and
    // import as NovelAI with every card silently discarded. `recognised` is what
    // separates "this isn't mine" from "this is mine, and it's broken".
    if (cards.recognised) {
      toast.error(cards.error)
      return
    }

    const scenario = parseScenario(json)
    if (scenario.ok) {
      setPendingScenario({ json, scenario: scenario.data })
      return
    }

    // Neither reader claims it. Prefer whichever one recognised the shape; with
    // no claim either way a top-level array could only ever have been a card
    // export, and anything else is likelier a broken scenario.
    const preferCards =
      scenario.recognised === false && json.trimStart().startsWith("[")
    toast.error(preferCards ? cards.error : scenario.error)
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={FILE_ACCEPT}
        className="hidden"
        onChange={handleFile}
      />
      {variant === "group-action" ? (
        <SidebarGroupAction
          title={LABEL}
          className="right-9"
          onClick={() => inputRef.current?.click()}
        >
          <Upload />
          <span className="sr-only">{LABEL}</span>
        </SidebarGroupAction>
      ) : variant === "icon" ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={LABEL}
          onClick={() => inputRef.current?.click()}
        >
          <Upload />
        </Button>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => inputRef.current?.click()}
        >
          <Upload data-icon="inline-start" />
          {LABEL}
        </Button>
      )}
      <ImportScenarioDialog
        pending={pendingScenario}
        onOpenChange={(open) => {
          if (!open) setPendingScenario(null)
        }}
      />
      <ImportStoryCardsDialog
        pending={pendingCards}
        onOpenChange={(open) => {
          if (!open) setPendingCards(null)
        }}
      />
      <ImportBackupDialog
        pending={pendingBackup}
        onOpenChange={(open) => {
          if (!open) setPendingBackup(null)
        }}
      />
    </>
  )
}
