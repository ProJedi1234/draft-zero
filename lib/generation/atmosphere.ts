// lib/generation/atmosphere.ts — Letting the story choose the colour it is read
// in. Server-only, and nobody's foreground.
//
// A sibling of summarize.ts in every structural way — same seam, same guard,
// same breaker, same "the next turn IS the retry" — and deliberately not
// coupled to it. The two jobs share a shape and nothing else: one is the
// story's memory and must not be lost, this one is the room's light and may be
// skipped for a week without anybody being able to name what is missing.
//
// That asymmetry is why this file is quieter than its sibling. It writes
// nothing on a bad answer, it says nothing when it gives up, and it declines to
// run at all far more often than it runs — see the gate in shouldCheck.
//
// NOTHING IN HERE MAY THROW INTO THE GENERATION PATH, for the same reason
// nothing in calls.ts or summarize.ts may: losing a tint is a decoration
// problem, losing the writer's paragraph is not.
import "server-only"

import { and, eq } from "drizzle-orm"

import { getDb } from "@/lib/db/client"
import { getAppSettings, getStory } from "@/lib/db/queries"
import { stories } from "@/lib/db/schema"
import {
  recordCallStarted,
  settleCall,
  type CallStart,
} from "@/lib/generation/calls"
import {
  DEFAULT_ATMOSPHERE_MODEL_ID,
  renderAtmosphereRequest,
  renderAtmosphereSystemPrompt,
} from "@/lib/generation/atmosphere-prompt"
import { resolveOpenRouterKey } from "@/lib/generation/key"
import { completeOnce, mapOpenRouterError } from "@/lib/generation/openrouter"
import type { GenerationUsage } from "@/lib/generation/types"
import { STORY_TINTS } from "@/lib/story-tint"
import { touchStory } from "@/lib/sync/bus"
import type {
  AtmosphereSettings,
  GenerationRequestKind,
  SettledCallStatus,
  Story,
  StoryEntry,
  ThinkingLevel,
} from "@/lib/types"

/**
 * Everything this module touches that is not itself.
 *
 * Injected rather than imported at the call sites, for the reason spelled out
 * on SummaryIo: a background job that reads a database, spends money and
 * publishes to every connected device is otherwise only testable by replacing
 * those modules for the whole process, and this suite shares one.
 *
 * `liveIo` below is the real thing, and is what every production path uses.
 */
export interface AtmosphereIo {
  getStory(storyId: string): Promise<Story | null>
  /** App-wide settings — read for the atmosphere bundle and nothing else. */
  settings(): Promise<{ atmosphere: AtmosphereSettings }>
  /** Null when OpenRouter is unconfigured — the offline mock path. */
  apiKey(): string | null
  complete(opts: {
    system: string
    user: string
    modelId: string
    thinking: ThinkingLevel
    providerTag: string | null
    temperature: number
    maxTokens: number
    zdr: boolean
    key: string
    signal?: AbortSignal
  }): Promise<{
    text: string
    generationId: string | null
    usage: GenerationUsage | null
  }>
  openCall(call: CallStart): Promise<void>
  settle(
    id: string,
    outcome: {
      status: SettledCallStatus
      generationId: string | null
      usage: GenerationUsage | null
    }
  ): Promise<void>
  /**
   * Persists the two numbers, unless the writer pinned a colour while the
   * check was in flight. Resolves to whether anything was written; false means
   * the press won and there is nothing to announce.
   */
  writeTint(
    storyId: string,
    tint: { hue: number; strength: number }
  ): Promise<boolean>
  announceChanged(storyId: string): void
}

export const liveIo: AtmosphereIo = {
  // The windowed read, on purpose: it reports the whole manuscript's word
  // count either way, and its tail is sized to cover the composition window —
  // an order of magnitude more prose than the few hundred words read here.
  // Only the summarizer pays for `full`, because only it wants what fell out.
  getStory: (storyId) => getStory(storyId),
  settings: getAppSettings,
  apiKey: resolveOpenRouterKey,
  complete: completeOnce,
  openCall: recordCallStarted,
  settle: settleCall,
  async writeTint(storyId, tint) {
    const db = await getDb()
    // The predicate is the race guard: a check reads tintAuto and then sits at
    // the provider for up to thirty seconds, and a swatch pressed in that
    // window pins the story (tint_auto = false) before this write lands. The
    // press must win — re-checking the flag here would still lose to a write
    // in between, so the flag is checked IN the write, where it cannot.
    const updated = await db
      .update(stories)
      .set({
        tintHue: tint.hue,
        tintStrength: tint.strength,
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(stories.id, storyId), eq(stories.tintAuto, true)))
      .returning({ id: stories.id })
    return updated.length > 0
  },
  // The same generic "this story moved" the manual swatch publishes, and on
  // purpose: clients answer it with router.refresh(), the server component
  // re-emits the hue custom properties, and every open device fades to the new
  // colour. A dedicated event would only be needed if a client had to know WHY
  // — and here it does not, because a tint that arrives unexplained is exactly
  // the feature.
  announceChanged: touchStory,
}

/**
 * The manuscript tail the model reads, in words.
 *
 * Enough to hold a scene and not much more. The question is "where is this
 * story now", and older prose answers a question that has already been asked —
 * a longer tail would only let a chapter that is over out-vote the one that is
 * running.
 */
const TAIL_WORDS = 500
/**
 * New words before the story is worth asking about again.
 *
 * The cost control and the hysteresis in one number: at roughly two or three
 * passages it is short enough that a real scene change is recoloured within a
 * few turns, and long enough that a writer retrying the same paragraph six
 * times pays for nothing. Only a story this process has never looked at
 * bypasses it — see shouldCheck.
 */
const NEW_WORDS_BEFORE_RECHECK = 150
/**
 * Output cap when the model is not asked to think: one word plus slack.
 */
const ATMOSPHERE_MAX_TOKENS = 200
/**
 * Output cap when it is. Reasoning tokens spend against the same cap as the
 * answer, so the 200 that is generous for one word starves a model told to
 * think at high before it emits any content at all — every check comes back
 * empty and reads to the breaker as a model that will not answer. A cap is a
 * ceiling, not a spend: a model that thinks briefly costs the same under
 * either number.
 */
const ATMOSPHERE_THINKING_MAX_TOKENS = 8_000
/** How long one check may take before it is abandoned as hung. */
const ATMOSPHERE_TIMEOUT_MS = 30_000
/**
 * Consecutive failures before this story stops trying.
 *
 * Same three strikes as the summarizer and for the same reason: retrying is
 * free, which is right for a rate limit and wrong for a retired model that
 * would otherwise fire a doomed call after every turn forever. Unlike the
 * summarizer, tripping is silent — see noteFailure.
 */
const FAILURE_LIMIT = 3

/**
 * Held on globalThis for the same reason the run registry and the summarizer's
 * are: dev HMR re-evaluates this module while a check is still in flight
 * against the old copy, and two registries means the per-story guard stops
 * guarding.
 */
const globalForAtmosphere = globalThis as unknown as {
  __draftZeroAtmosphere?: {
    /** Stories with a check in flight — one at a time, the whole concurrency rule. */
    inFlight: Set<string>
    /** Consecutive failures per story; cleared by any success. */
    failures: Map<string, number>
    /** Stories that have given up until the process restarts. */
    tripped: Set<string>
    /**
     * Manuscript length, in words, when this story was last asked about.
     *
     * In memory rather than on the story for the same reason the failure count
     * is: it is runtime state about a process, not a fact about a manuscript.
     * A restart costs one extra check per story, which is a cent and a colour
     * that may improve — nothing worth a column and a migration.
     */
    checkedAt: Map<string, number>
  }
}

const registry = (globalForAtmosphere.__draftZeroAtmosphere ??= {
  inFlight: new Set(),
  failures: new Map(),
  tripped: new Set(),
  checkedAt: new Map(),
})
registry.inFlight ??= new Set()
registry.failures ??= new Map()
registry.tripped ??= new Set()
registry.checkedAt ??= new Map()

/**
 * Let the story recolour the room if it has moved somewhere new. Safe to call
 * after every turn; the common answer is to do nothing.
 *
 * Never awaited by the caller and never throws — the promise is floated so a
 * writer's turn finishes at the moment their prose lands, not when an opinion
 * about its mood finishes.
 */
export function scheduleAtmosphere(storyId: string): void {
  void runAtmosphereForStory(storyId).catch((err) => {
    // Unreachable in principle: the runner handles its own failures. Here so
    // that a bug in the handling cannot take the process down with it.
    console.error("[atmosphere] escaped", err)
  })
}

/**
 * The awaitable form. `scheduleAtmosphere` is the one the run loop uses; this
 * one exists because "did it ask, and what did it conclude" is only answerable
 * by waiting, and the gate and the breaker are the parts worth pinning.
 */
export async function runAtmosphereForStory(
  storyId: string,
  io: AtmosphereIo = liveIo
): Promise<void> {
  if (registry.tripped.has(storyId)) return
  // Not a queue. A second check for the same story is dropped rather than
  // deferred: both would read almost the same tail and the later one would
  // win by arriving later, which is not a tiebreak anybody chose.
  if (registry.inFlight.has(storyId)) return
  registry.inFlight.add(storyId)
  try {
    await checkOnce(storyId, io)
  } catch (err) {
    console.error("[atmosphere] failed", err)
    noteFailure(storyId)
  } finally {
    registry.inFlight.delete(storyId)
  }
}

async function checkOnce(storyId: string, io: AtmosphereIo): Promise<void> {
  const key = io.apiKey()
  // No key means the app is running on the offline mock. A fabricated summary
  // is at least visibly a fabrication; a fabricated colour is indistinguishable
  // from taste, and the writer would spend the evening wondering why their
  // comedy went abyssal. Nothing is written and nothing is a failure.
  if (key === null) return

  const story = await io.getStory(storyId)
  if (story === null) return
  if (!shouldCheck(story)) return

  const { atmosphere } = await io.settings()
  const modelId = atmosphere.modelId ?? DEFAULT_ATMOSPHERE_MODEL_ID
  const callId = crypto.randomUUID()
  const requestKind: GenerationRequestKind = "atmosphere"
  // Opened before the request for the same reason a generation's row is: a call
  // that dies mid-flight was still billed, and this is the only trace it leaves.
  await io.openCall({
    id: callId,
    storyId,
    origStoryId: storyId,
    storyTitle: story.title,
    requestKind,
    modelId,
    thinking: atmosphere.thinking,
    providerName: atmosphere.providerTag,
  })

  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), ATMOSPHERE_TIMEOUT_MS)
  try {
    const result = await io.complete({
      system: renderAtmosphereSystemPrompt(),
      user: renderAtmosphereRequest({
        current: currentTintId(story),
        tail: manuscriptTail(story.entries, TAIL_WORDS),
        memory: story.memory,
      }),
      modelId,
      thinking: atmosphere.thinking,
      providerTag: atmosphere.providerTag,
      temperature: atmosphere.temperature,
      maxTokens:
        atmosphere.thinking === "off"
          ? ATMOSPHERE_MAX_TOKENS
          : ATMOSPHERE_THINKING_MAX_TOKENS,
      // Both, ORed — see the same line in summarize.ts. It is the story's prose
      // on the wire, and a manuscript that requires zero retention does not
      // stop requiring it because a different bundle sent it.
      zdr: atmosphere.zdr || story.settings.zdr,
      key,
      signal: abort.signal,
    })

    const choice = parseChoice(result.text)
    if (choice === null) {
      // A model that would not answer in one word is a failed check, not a
      // story that should lose its colour. Nothing is written, and it counts
      // toward the breaker because a model that cannot follow this instruction
      // will not start following it on the next turn.
      await io.settle(callId, {
        status: "error",
        generationId: result.generationId,
        usage: result.usage,
      })
      noteFailure(storyId)
      return
    }

    // The write comes BEFORE the settle, exactly as storeRecap does in
    // summarize.ts: a write that fails must land in the catch against a row
    // that is still open, not double-settle one already marked "ok" — settle's
    // error arm binds NULL over usage that was real and billed.
    //
    // A model naming the colour the story is already wearing means keep, and
    // writing it would push a change event at every open device to tell them
    // nothing changed.
    if (choice !== "keep" && choice.id !== currentTintId(story)) {
      const wrote = await io.writeTint(storyId, {
        hue: choice.hue,
        strength: choice.strength,
      })
      if (wrote) io.announceChanged(storyId)
    }
    await io.settle(callId, {
      status: "ok",
      generationId: result.generationId,
      usage: result.usage,
    })
    // Advanced on "keep" exactly as on a repaint. The question that was asked
    // was "has this story moved", and "no" is an answer — re-asking it every
    // turn until it says yes is how a hysteresis gate turns into a per-turn
    // call with extra steps.
    registry.checkedAt.set(storyId, story.wordCount)
    registry.failures.delete(storyId)
  } catch (err) {
    // A refusal and a fault settle the row identically: both are billed at zero
    // and both leave the story wearing what it was wearing.
    await io.settle(callId, {
      status: abort.signal.aborted ? "aborted" : "error",
      generationId: null,
      usage: null,
    })
    const { message } = mapOpenRouterError(err)
    console.error("[atmosphere]", message)
    noteFailure(storyId)
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Whether this story is worth a call right now.
 *
 * Two gates, and they are the whole cost story. `tintAuto` is the writer's
 * answer to "may you choose at all" — a hue they picked by hand turns it off,
 * and nothing here may overrule that. The word watermark is the answer to "has
 * anything happened since you last looked": a writer polishing one paragraph
 * moves the manuscript by a few words and the mood not at all.
 *
 * The first look this process takes at a story is eager — for a new story that
 * is the difference between the feature existing and the room staying grey —
 * but only the first. An untinted story whose model answered "keep" waits for
 * new words like any other: "no tint yet" is that model's standing answer, and
 * a bypass keyed on the hue would re-ask it after every single turn until it
 * changed its mind, at full price each time.
 */
function shouldCheck(story: Story): boolean {
  if (!story.tintAuto) return false
  const since = registry.checkedAt.get(story.id)
  if (since === undefined) return true
  return story.wordCount - since >= NEW_WORDS_BEFORE_RECHECK
}

/** The tint id the story is wearing, or null when it is untinted or off-palette. */
function currentTintId(story: Story): string | null {
  if (story.tintHue === null) return null
  const tint = STORY_TINTS.find((candidate) => candidate.hue === story.tintHue)
  return tint?.id ?? null
}

/**
 * The reply, as a decision — or null, which means the model did not answer the
 * question it was asked.
 *
 * Strict on purpose, with exactly one concession: punctuation and quoting are
 * stripped, so `"ember."` counts and `I'd say ember` does not. The concession
 * costs nothing (a model that wrapped one word in quotes still answered in one
 * word) and the strictness is load-bearing (anything that survives is written
 * into a stylesheet, and a model narrating its reasoning must be told so by the
 * breaker rather than by the writer noticing the colour never changes).
 */
function parseChoice(
  text: string
): "keep" | { id: string; hue: number; strength: number } | null {
  const raw = text.trim()
  // A sentence is not a one-word answer, and the longest legal one is nine
  // characters. Checked before the strip so that stripping cannot turn prose
  // into an accidental match.
  if (raw.length > 16) return null
  const word = raw.toLowerCase().replace(/[^a-z]/g, "")
  if (word === "keep") return word
  const tint = STORY_TINTS.find((candidate) => candidate.id === word)
  return tint === undefined
    ? null
    : { id: tint.id, hue: tint.hue, strength: tint.strength }
}

/**
 * The last `maxWords` words of the manuscript, newest passages last.
 *
 * Walks backwards and stops, rather than joining the whole manuscript and
 * slicing: this runs after every turn on stories that may be a hundred thousand
 * words long, and the tail is a fixed few hundred. Passage boundaries are kept
 * — the model is reading prose, and a paragraph cut mid-sentence at the front
 * is the one place it might mistake a formatting artifact for a mood.
 */
function manuscriptTail(entries: StoryEntry[], maxWords: number): string {
  const chosen: string[] = []
  let words = 0
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const text = entries[index]!.text.trim()
    if (text === "") continue
    chosen.push(text)
    words += text.split(/\s+/).length
    if (words >= maxWords) break
  }
  return chosen.reverse().join("\n\n")
}

/**
 * Count a failure, and trip once they stop looking transient.
 *
 * Silent, which is the one real departure from the summarizer. That bus event
 * earns its interruption by being the moment a story stops remembering itself;
 * this one would be an unprompted toast about a colour, sent to a writer
 * mid-sentence, about a job they may not know exists. The log line is for
 * whoever is looking, and the restart that fixes a bad key clears it anyway.
 */
function noteFailure(storyId: string): void {
  const count = (registry.failures.get(storyId) ?? 0) + 1
  registry.failures.set(storyId, count)
  if (count < FAILURE_LIMIT) return
  registry.tripped.add(storyId)
  console.error(
    `[atmosphere] giving up on ${storyId} after ${FAILURE_LIMIT} failures`
  )
}

/** Test seam: forget every story's failure history and watermark. */
export function resetAtmosphereState(): void {
  registry.inFlight.clear()
  registry.failures.clear()
  registry.tripped.clear()
  registry.checkedAt.clear()
}
