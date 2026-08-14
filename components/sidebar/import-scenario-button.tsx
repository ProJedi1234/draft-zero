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
  MAX_SCENARIO_BYTES,
  parseScenario,
  SCENARIO_FILE_ACCEPT,
} from "@/lib/import/novelai"
import { Button } from "@/components/ui/button"
import { SidebarGroupAction } from "@/components/ui/sidebar"
import {
  ImportScenarioDialog,
  type PendingScenario,
} from "@/components/sidebar/import-scenario-dialog"
import {
  ImportStoryCardsDialog,
  type PendingStoryCards,
} from "@/components/sidebar/import-story-cards-dialog"

const LABEL = "Import story"

/** Both formats, de-duplicated — a NovelAI scenario and a card export are both .json. */
const FILE_ACCEPT = [
  ...new Set(
    `${SCENARIO_FILE_ACCEPT},${STORY_CARD_FILE_ACCEPT}`
      .split(",")
      .map((ext) => ext.trim())
  ),
].join(",")

// The format isn't known until the file is read, so the picker guards with the
// larger of the two ceilings; each action re-checks its own.
const MAX_BYTES = Math.max(MAX_SCENARIO_BYTES, MAX_CARDS_BYTES)

/**
 * Picks a NovelAI `.scenario` or an AI Dungeon story-card export and opens the
 * matching import confirmation.
 *
 * The writer never declares which format they have: both arrive as .json and
 * the two readers recognise disjoint shapes — a card export is an array or an
 * object with a card list, a scenario is an object with a story prompt — so the
 * file is offered to each in turn and whichever one accepts it wins.
 *
 * The parse happens here purely to preview the file and to fail fast on
 * garbage; the actions re-parse the same text server-side.
 */
export function ImportScenarioButton({
  variant = "group-action",
}: {
  /** "group-action" is the sidebar's icon affordance; "button" is a labelled one. */
  variant?: "group-action" | "button"
}) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [pendingScenario, setPendingScenario] =
    React.useState<PendingScenario | null>(null)
  const [pendingCards, setPendingCards] =
    React.useState<PendingStoryCards | null>(null)

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // Reset first: picking the same file twice must fire `change` both times.
    event.target.value = ""
    if (!file) return

    if (file.size > MAX_BYTES) {
      toast.error("That file is too large to import.")
      return
    }

    const json = await file.text()

    const cards = parseStoryCards(json)
    if (cards.ok) {
      setPendingCards({ json, cards: cards.data })
      return
    }

    const scenario = parseScenario(json)
    if (scenario.ok) {
      setPendingScenario({ json, scenario: scenario.data })
      return
    }

    // Neither reader recognised it. A top-level array could only ever have been
    // a card export, so that reader's complaint is the useful one; anything else
    // is far likelier to be a broken scenario than a broken card file.
    toast.error(json.trimStart().startsWith("[") ? cards.error : scenario.error)
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
    </>
  )
}
