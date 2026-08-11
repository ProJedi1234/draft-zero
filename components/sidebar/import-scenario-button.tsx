"use client"

import * as React from "react"
import { Upload } from "lucide-react"
import { toast } from "sonner"

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

const LABEL = "Import scenario"

/**
 * Picks a NovelAI `.scenario` file and opens the import confirmation.
 *
 * The parse happens here purely to preview the file and to fail fast on
 * garbage; `importScenario` re-parses the same text server-side.
 */
export function ImportScenarioButton({
  variant = "group-action",
}: {
  /** "group-action" is the sidebar's icon affordance; "button" is a labelled one. */
  variant?: "group-action" | "button"
}) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [pending, setPending] = React.useState<PendingScenario | null>(null)

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // Reset first: picking the same file twice must fire `change` both times.
    event.target.value = ""
    if (!file) return

    if (file.size > MAX_SCENARIO_BYTES) {
      toast.error("That file is too large to be a scenario.")
      return
    }

    const json = await file.text()
    const parsed = parseScenario(json)
    if (!parsed.ok) {
      toast.error(parsed.error)
      return
    }
    setPending({ json, scenario: parsed.data })
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={SCENARIO_FILE_ACCEPT}
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
        pending={pending}
        onOpenChange={(open) => {
          if (!open) setPending(null)
        }}
      />
    </>
  )
}
