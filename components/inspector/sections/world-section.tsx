"use client"

import * as React from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Separator } from "@/components/ui/separator"
import { useServerSyncedValue } from "@/hooks/use-server-synced"
import { WorldProseField } from "@/components/inspector/world-prose-field"
import { useWorld } from "@/hooks/use-world"
import { randomId } from "@/lib/id"
import {
  MIND_MAX_CHARS,
  MEMORY_MAX_CHARS,
  type NpcState,
  type WorldOp,
  type WorldState,
} from "@/lib/services/world.schema"
import type { ActionResult } from "@/lib/types"
import {
  absoluteMinutes,
  clockTime,
  worldClockLabel,
  worldDay,
} from "@/lib/world/clock"
import { storyChanges } from "@/lib/sync/story-changes"

type Patch = (ops: WorldOp[]) => Promise<ActionResult<{ state: WorldState }>>

export function WorldSection({
  storyId,
  enabled,
}: {
  storyId: string
  enabled: boolean
}) {
  const { state, error, patch } = useWorld(storyId, enabled)
  return (
    <section aria-label="World" className="flex flex-col gap-4">
      <Separator />
      <h3 className="text-sm font-medium">World</h3>
      {error && (
        <div
          role="alert"
          className="flex flex-col gap-2 text-xs text-muted-foreground"
        >
          <p>{error}</p>
          <Button
            size="xs"
            variant="outline"
            onClick={() => storyChanges.publish(storyId)}
          >
            Retry
          </Button>
        </div>
      )}
      {state ? (
        <>
          <WorldClock minutes={state.minutes} patch={patch} />
          {state.npcs.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No living NPCs. Turn on Living NPC for a character in the lore
              editor.
            </p>
          )}
          {state.npcs.map((npc) => (
            <NPCRow key={npc.loreEntryId} npc={npc} patch={patch} />
          ))}
        </>
      ) : (
        !error && (
          <p role="status" className="text-xs text-muted-foreground">
            Loading world…
          </p>
        )
      )}
    </section>
  )
}

function WorldClock({ minutes, patch }: { minutes: number; patch: Patch }) {
  const uid = React.useId()
  const [editing, setEditing] = React.useState(false)
  const [pending, startTransition] = React.useTransition()
  const day = useServerSyncedValue(String(worldDay(minutes)), { hold: editing })
  const time = useServerSyncedValue(clockTime(minutes), { hold: editing })
  const absolute = absoluteMinutes(Number(day.value), time.value)
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        if (absolute === null) return
        startTransition(async () => {
          const result = await patch([{ type: "set-clock", minutes: absolute }])
          if (result.ok) setEditing(false)
          else toast.error(result.error)
        })
      }}
    >
      <Label>Clock</Label>
      <p className="text-sm tabular-nums">{worldClockLabel(minutes)}</p>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <Label htmlFor={`${uid}-day`}>Day</Label>
          <Input
            id={`${uid}-day`}
            type="number"
            min={1}
            step={1}
            required
            disabled={pending}
            value={day.value}
            onChange={(e) => {
              setEditing(true)
              day.setLocal(e.target.value)
            }}
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <Label htmlFor={`${uid}-time`}>Time</Label>
          <Input
            id={`${uid}-time`}
            type="time"
            required
            disabled={pending}
            value={time.value}
            onChange={(e) => {
              setEditing(true)
              time.setLocal(e.target.value)
            }}
          />
        </div>
      </div>
      <Button
        type="submit"
        size="sm"
        variant="outline"
        disabled={pending || absolute === null}
      >
        Set clock
      </Button>
    </form>
  )
}

function NPCRow({ npc, patch }: { npc: NpcState; patch: Patch }) {
  const uid = React.useId()
  const [text, setText] = React.useState("")
  const [importance, setImportance] = React.useState(3)
  const [adding, startAdd] = React.useTransition()
  const [striking, setStriking] = React.useState<Set<string>>(() => new Set())

  function strike(memoryId: string) {
    setStriking((previous) => new Set(previous).add(memoryId))
    const reveal = () =>
      setStriking((previous) => {
        const next = new Set(previous)
        next.delete(memoryId)
        return next
      })
    let settled = false
    // Send when the toast closes rather than on a timer: a hovered toast
    // pauses, and Undo must work for as long as it is visible.
    const send = async () => {
      if (settled) return
      settled = true
      const result = await patch([
        { type: "strike-memory", loreEntryId: npc.loreEntryId, memoryId },
      ])
      reveal()
      if (!result.ok) toast.error(result.error)
    }
    toast("Memory struck.", {
      duration: 6000,
      onAutoClose: send,
      onDismiss: send,
      action: {
        label: "Undo",
        onClick: () => {
          settled = true
          reveal()
        },
      },
    })
  }

  function addMemory() {
    const submitted = text
    startAdd(async () => {
      const result = await patch([
        {
          type: "add-memory",
          loreEntryId: npc.loreEntryId,
          memory: { id: randomId(), text: submitted, importance },
        },
      ])
      if (result.ok) {
        setText("")
        setImportance(3)
      } else toast.error(result.error)
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <Separator />
      <h4 className="text-sm font-medium">{npc.name}</h4>
      <WorldProseField
        title="On their mind"
        value={npc.mind}
        placeholder="Nothing yet"
        maxLength={MIND_MAX_CHARS}
        trim
        save={(mind) =>
          patch([{ type: "set-mind", loreEntryId: npc.loreEntryId, mind }])
        }
      />
      <div className="flex flex-col gap-2">
        <Label>Memories</Label>
        {npc.memories.length === 0 && (
          <p className="text-xs text-muted-foreground">Nothing yet</p>
        )}
        {[...npc.memories]
          .reverse()
          .filter((memory) => !striking.has(memory.id))
          .map((memory) => (
            <div key={memory.id} className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span>
                  day {worldDay(memory.minutes)} ·{" "}
                  <span
                    role="img"
                    aria-label={`Importance ${memory.importance} of 5`}
                  >
                    {"●".repeat(memory.importance)}
                    {"○".repeat(5 - memory.importance)}
                  </span>
                </span>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => strike(memory.id)}
                  aria-label={`Strike memory: ${memory.text}`}
                >
                  Strike
                </Button>
              </div>
              <p className="text-sm whitespace-pre-wrap">{memory.text}</p>
            </div>
          ))}
      </div>
      {/* A div, not a form: <Textarea> renders its own form owner for iOS. */}
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${uid}-memory`}>Add memory</Label>
        <Textarea
          id={`${uid}-memory`}
          placeholder="What did they witness?"
          maxLength={MEMORY_MAX_CHARS}
          value={text}
          disabled={adding}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="flex items-end gap-2">
          <div className="flex flex-1 flex-col gap-1">
            <Label htmlFor={`${uid}-importance`}>Importance</Label>
            <Input
              id={`${uid}-importance`}
              type="number"
              min={1}
              max={5}
              step={1}
              required
              value={importance}
              disabled={adding}
              onChange={(e) => setImportance(Number(e.target.value))}
            />
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={addMemory}
            disabled={
              adding ||
              !text.trim() ||
              importance < 1 ||
              importance > 5 ||
              !Number.isInteger(importance)
            }
          >
            Add memory
          </Button>
        </div>
      </div>
    </div>
  )
}
