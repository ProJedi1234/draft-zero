// lib/services/generation.ts — Starting and stopping a server-owned generation
// run, callable from a server action, a route handler or an MCP tool alike.
import "server-only"

import { nextTakeVariant } from "@/lib/db/entry-writes"
import { appendActionEntry } from "@/lib/services/entries"
import {
  getGenerationBaseline,
  getStory,
  listLorebookEntries,
  listModelProfiles,
} from "@/lib/db/queries"
import { composeContext } from "@/lib/generation/context"
import { listModelEndpoints } from "@/lib/generation/endpoints"
import {
  launchRun,
  releaseRun,
  reserveRun,
  stopRun,
} from "@/lib/generation/live"
import { listModels } from "@/lib/generation/models"
import { resolveProfileSettings } from "@/lib/generation/resolve"
import type { Service } from "@/lib/services/context"
import {
  startGenerationInput,
  stopGenerationInput,
  type StartGenerationInput,
  type StopGenerationInput,
} from "@/lib/services/generation.schema"
import { fail, ok, parseInput } from "@/lib/services/result"
import { touchStory } from "@/lib/sync/bus"
import {
  clampContextWindow,
  endpointForTag,
  type GenerationRequestKind,
  type GenerationSettings,
} from "@/lib/types"

// The kinds a CLIENT may name, which is deliberately not every kind that
// exists: "summarize" and "atmosphere" are minted server-side only, and a
// browser able to ask for one could bill an account for calls that leave no
// passage behind to notice.
const REQUEST_KINDS: string[] = ["generate", "retry", "continue"]
const BUSY_ERROR = "A generation is already running for this story."
const STORY_NOT_FOUND = "Story not found."

/**
 * One round-trip that starts a generation the SERVER owns:
 * - `kind` + `userText`: the writer took a turn — it is translated and
 *   persisted first, so the context is composed against a story that already
 *   ends with it
 * - neither: plain Continue, appends nothing
 * Then composes context from fresh DB state and launches the run loop as a
 * detached task. The response carries only the run's identity — prose arrives
 * over /api/generation/subscribe, and closing that stream aborts nothing.
 * `turnId` ties the writer's row and the passage it produces into one undo step:
 * the client mints it before the round-trip, and the run loop's persist extends
 * the op the turn already wrote here rather than recording a second one.
 * `variantGroupId` marks this as a Retry, and the slot it names is left OUT of
 * the composed context — see the filter below.
 *
 * Fails with `conflict` when a run is already active for the story: one manuscript,
 * one caret. The slot is RESERVED before the turn persists — the awaits between
 * here and launchRun are exactly where two devices' Sends used to interleave,
 * each passing a courtesy check and persisting a turn only for one to lose the
 * launch — so a double-Send now fails before it writes anything, and the loser's
 * draft goes back to its composer with the manuscript untouched.
 */
export const startGeneration: Service<
  StartGenerationInput,
  { runId: string; userEntryId: string | null }
> = async (raw, ctx) => {
  // Synchronous on purpose: nothing may await between the call and the claim.
  const parsed = parseInput(startGenerationInput, raw)
  if (!parsed.ok) return parsed
  const { storyId, ...opts } = parsed.data

  // The claim, not a courtesy check: reserveRun answers "busy" and takes the
  // slot in one synchronous operation, so nothing below runs unless this call
  // is the story's one generation. Released in the finally — the reservation
  // guards the awaits; once launchRun wins the active slot it takes over.
  // The turnId rides along as the reservation's token: a Stop pressed before
  // this call returns a runId can only name the story, and the token is what
  // ties that bare stop to THIS start rather than to whatever run happens to
  // hold the story — see stopRun.
  if (!reserveRun(storyId, opts.turnId ?? null)) {
    return fail("conflict", BUSY_ERROR)
  }
  try {
    // A turn needs both halves: `kind` alone has nothing to translate, and
    // `userText` alone cannot be translated without knowing which voice it is.
    // Either way the honest reading is Continue, so nothing is appended.
    let userEntryId: string | null = null
    if (opts.kind !== undefined && opts.userText !== undefined) {
      const appended = await appendActionEntry(
        {
          storyId,
          kind: opts.kind,
          rawText: opts.userText,
          turnId: opts.turnId ?? null,
        },
        ctx
      )
      if (!appended.ok) return appended
      userEntryId = appended.data.entry.id
      // The origin device echoes this row locally, but a passive device attaching
      // on run-started has no echo — without this touch it would watch the whole
      // passage stream in under a turn it cannot see, which only pops in at the
      // end. The origin's extra refresh is harmless: it delivers the row the echo
      // already masks.
      touchStory(storyId)
    }

    const [story, lorebookEntries, models, profiles] = await Promise.all([
      getStory(storyId),
      listLorebookEntries(storyId),
      // Cached for an hour in-process, so this is nearly free — see models.ts.
      listModels(),
      listModelProfiles(),
    ])

    if (!story) return fail("not_found", STORY_NOT_FOUND)

    // The profile this ONE request runs under: the one the caller picked, or
    // the one the story follows. A picked id that names nothing is refused
    // rather than quietly falling back to the story's settings — the writer
    // asked for a specific model, and generating under a different one is a
    // worse answer than not generating at all.
    const picked =
      opts.profileId === undefined
        ? null
        : (profiles.find((profile) => profile.id === opts.profileId) ?? null)
    if (opts.profileId !== undefined && !picked) {
      return fail("not_found", "That profile is no longer available.")
    }

    // `story.settings` is already EFFECTIVE — getStory resolved it through the
    // followed profile (see resolveGenerationSettings) — so it is the right
    // base for every request except one made under a picked profile, which is
    // resolved here against the same global defaults getStory would have used.
    // Either way the story's own columns are only ever READ.
    const effective = picked
      ? resolveProfileSettings(picked.settings, await getGenerationBaseline())
      : story.settings

    // Only fetched when the request pins a provider, and cached five minutes
    // per model when it does — see endpoints.ts. Against the EFFECTIVE model:
    // a picked profile routinely names a different one than the story does.
    const endpoints =
      effective.providerTag == null
        ? []
        : await listModelEndpoints(effective.modelId)

    //
    // The stored window can exceed what the selected model accepts: the catalog
    // is live, so a row written against a bigger model (or against MOCK_MODELS,
    // before a key was configured) outlives the model that justified it. The
    // inspector clamps for display and writes the fix-up back, but this is the
    // path that actually builds the request — it clamps for itself rather than
    // trusting the row. The clamped value rides into the run's settings too, so
    // nothing downstream ever sees a window the assembled context wasn't built
    // against.
    // A pinned endpoint's window wins over the model's: a third-party host often
    // serves a shorter one, and it is the host that will reject the request.
    const settings: GenerationSettings = {
      ...effective,
      contextWindow: clampContextWindow(
        effective.contextWindow,
        endpointForTag(endpoints, effective.providerTag)?.contextLength ??
          models.find((m) => m.id === effective.modelId)?.contextLength ??
          0
      ),
    }

    // What the take will say wrote it. The story's own profile answers for an
    // ordinary generation, so a manuscript records which profile each passage
    // came from even when nobody ever picks one; null is a Custom story, whose
    // settings have no name to give.
    const profileName =
      picked?.name ??
      profiles.find((profile) => profile.id === story.profileId)?.name ??
      null

    // A Retry is an ALTERNATIVE to a passage, not a continuation of it, so the
    // slot being retried is dropped before the context is composed. Leave it in
    // and the model is handed a story that ends with the very take it is meant to
    // replace, and dutifully writes what comes next — which then gets stored as a
    // second take of that same slot, so flipping between takes shows passage N
    // and passage N+1 instead of two versions of passage N.
    //
    // Filtering by slot rather than by row id covers the inactive takes too: they
    // are not in `story.entries` today, but the rule "this slot is not part of
    // the story we are asking about" is the one that stays true if that changes.
    // The old take is still on disk and untouched — this only decides what the
    // model is shown. Note the seed moves with `entries.length`, and `variant`
    // (below) is bumped per take on top of that, so successive takes stay
    // distinct.
    const storyForContext =
      opts.variantGroupId === undefined
        ? story
        : {
            ...story,
            entries: story.entries.filter(
              (entry) => entry.variantGroupId !== opts.variantGroupId
            ),
          }

    // The seed's retry ordinal comes from the slot's real takes, not from the
    // pressing tab: a per-device counter cannot see the takes other devices
    // already made, and two "first" retries sharing a seed reproduce the same
    // passage verbatim.
    const variant =
      opts.variantGroupId === undefined
        ? 0
        : await nextTakeVariant(storyId, opts.variantGroupId)

    const context = composeContext({
      story: storyForContext,
      lorebookEntries,
      variant,
      contextWindow: settings.contextWindow,
    })

    const launched = launchRun({
      storyId,
      requestKind:
        opts.requestKind && REQUEST_KINDS.includes(opts.requestKind)
          ? (opts.requestKind as GenerationRequestKind)
          : "generate",
      userEntryId,
      removingEntryIds: opts.removingEntryIds ?? [],
      turnId: opts.turnId ?? null,
      variantGroupId: opts.variantGroupId,
      context,
      settings,
      profileName,
    })
    // Unreachable while the reservation above holds the slot — kept as a
    // defensive answer rather than a non-null assertion, because a null here
    // must fail closed, not launch nothing and report a runId.
    if (!launched) return fail("conflict", BUSY_ERROR)

    // No revalidation here on purpose: this response is what the writer is
    // waiting on before a single token appears, and re-rendering the whole layout
    // to deliver a row the canvas is already echoing buys nothing but latency.
    // The run loop touches the story when it settles, and the client calls
    // syncStoryTree once its turn settles — including when it fails.
    return ok({ runId: launched.runId, userEntryId })
  } finally {
    releaseRun(storyId)
  }
}

/**
 * The only way a generation is ever aborted — closing a subscribe stream
 * detaches a listener and nothing else. Any device may call this, not just the
 * one that started the run; a no-op when nothing is running. The run loop
 * persists whatever prose had streamed and ends the run "aborted".
 *
 * `runId` is the run the caller was mirroring, so a Stop from a device that
 * slept through a settle cannot abort the newer run that now owns the story.
 * Null while the caller's own start is still in flight; `startTurnId` is that
 * start's turnId, and the server aborts or latches only the run/reservation
 * carrying it — a foreign run holding the story is out of reach — see stopRun.
 */
export const stopGeneration: Service<StopGenerationInput, null> = async (
  raw
) => {
  const parsed = parseInput(stopGenerationInput, raw)
  if (!parsed.ok) return parsed
  const { storyId, runId, startTurnId } = parsed.data
  stopRun(storyId, runId, startTurnId)
  return ok(null)
}
