// POST /api/image-prompt — launch a prompt derivation and return its id.
//
// Two modes through one endpoint, chosen by whether `brief` arrives non-empty.
// With a brief, the writer has said what they want drawn and the call's job is
// to realize it: the brief matches lore, the summary and memory ride along, and
// the recent manuscript is deliberately absent — reading it would pull the
// prompt back toward the moment the writer chose not to draw. Without one, the
// original behaviour is unchanged, which is how "illustrate what is happening
// right now" survives as the same gesture rather than a second control.
//
// Thin, like POST /api/image: everything past the turn this route composes is a
// detached loop in lib/images/derive-run.ts. It used to stream the answer down
// this response body and settle the ledger from inside it, which made the
// develop the one paid call a closed tab threw away — and the one thing the
// writer's other devices could not watch. The client subscribes to
// /api/image-prompt/subscribe with the runId this returns; every other device
// on the story gets the same runId over the sync channel's derive-run-started.
import { getAppSettings, listLorebookEntries, getStory } from "@/lib/db/queries"
import { composeContext } from "@/lib/generation/context"
import { LORE_BUDGET_MAX } from "@/lib/types"
import { selectBriefLore } from "@/lib/images/brief-lore"
import { launchDeriveRun } from "@/lib/images/derive-run"
import { deriveImagePrompt } from "@/lib/images/derive-prompt"
import {
  BRIEF_DERIVATION_SYSTEM_PROMPT,
  DERIVATION_SYSTEM_PROMPT,
  renderBriefDerivationPrompt,
  renderDerivationPrompt,
} from "@/lib/images/derivation-prompt"

export const runtime = "nodejs"

/**
 * The derivation's own context budget — deliberately NOT the story's window.
 *
 * This call has been at both extremes. It started at 2,048 tokens with the
 * summary silently dropped, which is where character continuity went to die:
 * anyone last described outside the slice was re-invented every derivation.
 * The fix swung to the story's full window, which over-corrected — a
 * description of one visible moment does not need six thousand tokens of
 * manuscript, and past a point the extra prose actively dilutes the scene
 * toward the story's average.
 *
 * What the swing taught is that continuity never lived in the raw window: it
 * lives in the SUMMARY (fixed overhead, always rides) and the LORE. So the
 * budget is small and lore-heavy: 4,096 tokens with lore allowed its maximum
 * share, which after the measured overhead, memory and summary leaves roughly
 * one to two thousand tokens of recent manuscript — the moment and its
 * immediate approach, not the book. composeContext returns lore's unspent
 * share to prose, so the split self-balances per story.
 *
 * App-wide rather than per story — a derivation budget is a property of how
 * the image feature works, not of any one manuscript — and configured on the
 * settings page (app_settings.image_context_tokens) beside the default image
 * model, with 4,096 as the shipped default.
 */

/** A brief is a sentence or two. Past this it is not shorthand any more. */
const MAX_BRIEF_CHARS = 4_000

export async function POST(req: Request): Promise<Response> {
  let storyId: string
  let brief: string
  let excludedLoreIds: string[]
  try {
    const body = (await req.json()) as {
      storyId?: unknown
      brief?: unknown
      excludedLoreIds?: unknown
    }
    if (typeof body.storyId !== "string" || body.storyId === "") {
      return Response.json({ error: "storyId is required." }, { status: 400 })
    }
    if (
      body.brief !== undefined &&
      (typeof body.brief !== "string" || body.brief.length > MAX_BRIEF_CHARS)
    ) {
      return Response.json({ error: "Malformed brief." }, { status: 400 })
    }
    storyId = body.storyId
    brief = typeof body.brief === "string" ? body.brief.trim() : ""
    excludedLoreIds = Array.isArray(body.excludedLoreIds)
      ? body.excludedLoreIds.filter(
          (id): id is string => typeof id === "string"
        )
      : []
  } catch {
    return Response.json({ error: "Malformed request." }, { status: 400 })
  }

  const [story, lorebookEntries, appSettings] = await Promise.all([
    getStory(storyId),
    listLorebookEntries(storyId),
    getAppSettings(),
  ])
  if (!story) {
    return Response.json({ error: "Story not found." }, { status: 404 })
  }

  // A brief IS the scene, so it works on a story with nothing written yet —
  // "the tomb door, torch raised" needs no manuscript to be drawable. The
  // refusal below is only about the other path, where the story window is the
  // only thing there is to describe.
  const briefMode = brief !== ""
  if (!briefMode && story.entries.length === 0) {
    // Nothing to describe yet. An honest refusal beats spending a call to have
    // a model invent an opening scene the story has not written.
    return Response.json(
      { error: "Write something first — there's no scene to describe yet." },
      { status: 409 }
    )
  }

  // Selected with the same function the composer uses for the ids it records
  // on the draw, so the entries named on screen and the entries the model is
  // handed are one list — minus the writer's muted chips, and trimmed to the
  // shared budget when a cascade runs away (see BRIEF_LORE_CHAR_BUDGET).
  const briefLore = briefMode
    ? selectBriefLore(lorebookEntries, brief, new Set(excludedLoreIds)).map(
        (match) => match.entry
      )
    : []

  // The two turns, and the two offline stand-ins beside them. Built together
  // so the branch is taken exactly once: everything past this point is the same
  // run, the same ledger row and the same channel whichever mode we are in.
  //
  // Brief mode reads memory and the summary off the story directly rather than
  // composing a context — it has no window to budget, and the whole point is
  // that the recent manuscript stays out of it.
  let turn: { system: string; user: string }
  let offlineText: string
  if (briefMode) {
    turn = {
      system: BRIEF_DERIVATION_SYSTEM_PROMPT,
      user: renderBriefDerivationPrompt({
        brief,
        memory: story.memory,
        lore: briefLore,
        summary: story.summary,
      }),
    }
    // Deliberately a dumb one: the brief with its matched lore stapled on,
    // which reads as obviously unwritten. A plausible-looking offline result is
    // how you ship a feature that was never once run against a model.
    offlineText = [brief, ...briefLore.map((entry) => entry.content.trim())]
      .filter((part) => part !== "")
      .join(", ")
  } else {
    const context = composeContext({
      story,
      lorebookEntries,
      variant: 0,
      contextWindow: appSettings.imageContextTokens,
      // Lore's ceiling, not its floor: composeContext hands lore's unspent
      // share back to story prose, so a lore-light story gets its space back
      // for free.
      loreBudget: LORE_BUDGET_MAX,
    })
    turn = {
      system: DERIVATION_SYSTEM_PROMPT,
      user: renderDerivationPrompt(context),
    }
    offlineText = deriveImagePrompt(context.storyText, context.approxTokens)
  }

  const launched = launchDeriveRun({
    storyId: story.id,
    storyTitle: story.title,
    brief,
    system: turn.system,
    user: turn.user,
    offlineText,
    settings: story.settings,
  })
  if (!launched) {
    // A second wand tap while the first is still writing. Refused rather than
    // queued: the writer would be billed twice for two answers to one brief,
    // and their composer is already showing the one they are getting.
    return Response.json(
      { error: "A prompt is already being written for this story." },
      { status: 409 }
    )
  }

  return Response.json({ runId: launched.runId })
}
