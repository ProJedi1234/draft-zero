import "server-only"

import { eq } from "drizzle-orm"

import { getDb } from "@/lib/db/client"
import { getAppSettings, getStoryFull } from "@/lib/db/queries"
import { stories, worldPatches } from "@/lib/db/schema"
import { readWorldData } from "@/lib/db/world"
import { recordCallStarted, settleCall } from "@/lib/generation/calls"
import { resolveKeyForModel } from "@/lib/generation/key"
import { firstMatchingKey } from "@/lib/generation/lorebook"
import { completeOnce, mapOpenRouterError } from "@/lib/generation/openrouter"
import type { SummaryIo } from "@/lib/generation/summarize"
import { DEFAULT_SUMMARIZER_MODEL_ID } from "@/lib/generation/summary-prompt"
import {
  renderWorldRequest,
  WORLD_SYSTEM_PROMPT,
} from "@/lib/generation/world-prompt"
import { publishWorldChange } from "@/lib/services/commit"
import { worldPassOutput, type WorldOp } from "@/lib/services/world.schema"
import type { Story } from "@/lib/types"
import { parseStoryFeatures } from "@/lib/world/features"
import { foldWorld, isNpc, worldPrefix } from "@/lib/world/fold"

export interface WorldIo {
  getStory(storyId: string): Promise<Story | null>
  load(storyId: string): ReturnType<typeof readWorldData>
  settings: SummaryIo["settings"]
  apiKey: SummaryIo["apiKey"]
  complete: SummaryIo["complete"]
  openCall: SummaryIo["openCall"]
  settle: SummaryIo["settle"]
  store(
    storyId: string,
    entryId: string,
    ops: WorldOp[],
    revision: string
  ): Promise<boolean | "stale">
  announce(storyId: string): void
}

export const liveWorldIo: WorldIo = {
  getStory: getStoryFull,
  async load(storyId) {
    return readWorldData(await getDb(), storyId)
  },
  settings: getAppSettings,
  apiKey: resolveKeyForModel,
  complete: completeOnce,
  openCall: recordCallStarted,
  settle: settleCall,
  async store(storyId, entryId, ops, revision) {
    const db = await getDb()
    return db.transaction(async (tx) => {
      const [story] = await tx
        .select()
        .from(stories)
        .where(eq(stories.id, storyId))
        .for("update")
      if (!story || !parseStoryFeatures(story.featuresJson).world?.enabled)
        return false
      const data = await readWorldData(tx, storyId)
      const entry = data.entries.find((entry) => entry.id === entryId)
      // A slow answer must not attach itself to a deleted or superseded take.
      if (!entry || entry.deletedAt !== null || !entry.isActive) return false
      if (
        data.patches.some(
          (patch) => patch.entryId === entryId && patch.source === "world"
        )
      )
        return false
      if (
        worldPrefix(data.entries, data.patches, entry.position).revision !==
        revision
      )
        return "stale"
      const inserted = await tx
        .insert(worldPatches)
        .values({
          id: crypto.randomUUID(),
          storyId,
          entryId,
          source: "world",
          opsJson: JSON.stringify(ops),
          createdAt: new Date().toISOString(),
        })
        .onConflictDoNothing()
        .returning({ id: worldPatches.id })
      return inserted.length > 0
    })
  },
  announce: publishWorldChange,
}

const globalWorld = globalThis as unknown as {
  __draftZeroWorld?: {
    queues: Map<string, Set<string>>
    failures: Map<string, number>
    tripped: Set<string>
  }
}
const registry = (globalWorld.__draftZeroWorld ??= {
  queues: new Map(),
  failures: new Map(),
  tripped: new Set(),
})

export function scheduleWorld(storyId: string, entryId: string): void {
  void runWorldForStory(storyId, entryId).catch((error) =>
    console.error("[world] escaped", error)
  )
}

export async function runWorldForStory(
  storyId: string,
  entryId: string,
  io: WorldIo = liveWorldIo
): Promise<void> {
  if (registry.tripped.has(storyId)) return
  const running = registry.queues.get(storyId)
  if (running) {
    running.add(entryId)
    return
  }
  const pending = new Set([entryId])
  registry.queues.set(storyId, pending)
  const attempted = new Set<string>()
  const retried = new Set<string>()
  // Reserve room for the requested passage without backfilling a whole old story.
  let catchUpRemaining = 4
  try {
    while (pending.size > 0 && !registry.tripped.has(storyId)) {
      const requested = new Set(pending)
      const story = await io.getStory(storyId)
      if (!story?.features.world?.enabled) break
      const data = await io.load(storyId)
      const generated = new Set(
        story.entries.filter((e) => e.source === "generated").map((e) => e.id)
      )
      const patched = new Set(
        data.patches.filter((p) => p.source === "world").map((p) => p.entryId)
      )
      const candidates = data.entries
        .filter(
          (e) =>
            e.isActive &&
            e.deletedAt === null &&
            generated.has(e.id) &&
            !patched.has(e.id)
        )
        .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
      for (const id of requested)
        if (!candidates.some((e) => e.id === id)) pending.delete(id)
      const target = candidates.find((e) => requested.has(e.id))
      if (!target) continue
      const earlier =
        catchUpRemaining > 0
          ? candidates.find(
              (e) => e.position < target.position && !attempted.has(e.id)
            )
          : undefined
      const next = earlier ?? target
      if (earlier) catchUpRemaining--
      pending.delete(next.id)
      attempted.add(next.id)
      if (
        (await worldOnce(story, data, next.id, io)) === "stale" &&
        !retried.has(next.id)
      ) {
        retried.add(next.id)
        pending.add(next.id)
      }
    }
  } catch (error) {
    console.error("[world]", mapOpenRouterError(error).message)
    noteFailure(storyId)
  } finally {
    registry.queues.delete(storyId)
  }
}

async function worldOnce(
  story: Story,
  data: Awaited<ReturnType<WorldIo["load"]>>,
  entryId: string,
  io: WorldIo
): Promise<"stale" | void> {
  const storyId = story.id
  const passageIndex = story.entries.findIndex(
    (entry) => entry.id === entryId && entry.source === "generated"
  )
  if (passageIndex === -1) return
  if (
    data.patches.some(
      (patch) => patch.entryId === entryId && patch.source === "world"
    )
  )
    return
  const passage = story.entries[passageIndex]
  const previous = story.entries[passageIndex - 1]
  const playerTurn = previous?.source === "user" ? previous.text : ""
  const present = data.lore.filter(
    (entry) =>
      isNpc(entry) &&
      entry.enabled &&
      firstMatchingKey(
        entry,
        `${playerTurn}\n${passage.text}`.toLowerCase()
      ) !== null
  )
  // Only the prefix belongs in this passage's input if another turn landed meanwhile.
  const prefix = worldPrefix(
    data.entries,
    data.patches,
    passage.position ?? Infinity
  )
  const state = foldWorld(storyId, prefix.entries, data.lore, prefix.patches)
  const clockInitialized = prefix.patches.some((patch) =>
    patch.ops.some(
      (op) => op.type === "set-clock" || op.type === "advance-clock"
    )
  )
  const { summarizer } = await io.settings()
  const modelId = summarizer.modelId ?? DEFAULT_SUMMARIZER_MODEL_ID
  const key = io.apiKey(modelId)
  if (key === null) return
  const callId = crypto.randomUUID()
  await io.openCall({
    id: callId,
    storyId,
    origStoryId: storyId,
    storyTitle: story.title,
    requestKind: "world",
    modelId,
    thinking: summarizer.thinking,
    providerName: summarizer.providerTag,
  })
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), 60_000)
  let result: Awaited<ReturnType<WorldIo["complete"]>> | undefined
  let status: "ok" | "error" | "aborted" = "error"
  try {
    result = await io.complete({
      system: WORLD_SYSTEM_PROMPT,
      user: renderWorldRequest({
        pacing: story.features.world?.pacing ?? "",
        state,
        clockInitialized,
        playerTurn,
        passage: passage.text,
        present,
      }),
      modelId,
      thinking: summarizer.thinking,
      providerTag: summarizer.providerTag,
      temperature: summarizer.temperature,
      maxTokens: summarizer.maxTokens ?? 4096,
      zdr: summarizer.zdr || story.settings.zdr,
      key,
      signal: abort.signal,
    })
    const answer = worldPassOutput.parse(JSON.parse(result.text))
    const ids = new Set(present.map((entry) => entry.id))
    const uniqueIds = new Set(answer.npcs.map((npc) => npc.loreEntryId))
    if (
      result.truncated ||
      uniqueIds.size !== answer.npcs.length ||
      uniqueIds.size !== ids.size ||
      answer.npcs.some((npc) => !ids.has(npc.loreEntryId))
    )
      throw new Error("Invalid world answer.")
    const ops: WorldOp[] = [
      clockInitialized
        ? { type: "advance-clock", minutes: answer.minutesElapsed }
        : { type: "set-clock", minutes: answer.minuteOfDay ?? 480 },
    ]
    for (const npc of answer.npcs) {
      ops.push({
        type: "set-mind",
        loreEntryId: npc.loreEntryId,
        mind: npc.mind,
      })
      for (const memory of npc.memories)
        ops.push({
          type: "add-memory",
          loreEntryId: npc.loreEntryId,
          memory: { id: crypto.randomUUID(), ...memory },
        })
    }
    const stored = await io.store(storyId, entryId, ops, prefix.revision)
    if (stored === true) io.announce(storyId)
    status = "ok"
    registry.failures.delete(storyId)
    if (stored === "stale") return "stale"
  } catch (error) {
    status = abort.signal.aborted ? "aborted" : "error"
    console.error("[world]", mapOpenRouterError(error).message)
    noteFailure(storyId)
  } finally {
    clearTimeout(timer)
    await io.settle(callId, {
      status,
      generationId: result?.generationId ?? null,
      usage: result?.usage ?? null,
    })
  }
}

function noteFailure(storyId: string): void {
  const failures = (registry.failures.get(storyId) ?? 0) + 1
  registry.failures.set(storyId, failures)
  if (failures >= 3) {
    registry.tripped.add(storyId)
    console.error("[world] stopped", storyId)
  }
}

export function resetWorldState(): void {
  registry.queues.clear()
  registry.failures.clear()
  registry.tripped.clear()
}
