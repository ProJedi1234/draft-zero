# Living world (v1)

NPCs that remember what they witnessed, carry one line of what is on their mind, and live on a story clock that moves with the prose. The wire contract is `lib/services/world.schema.ts`.

## Scope

In v1:

- Story clock, inferred after each passage from the prose and the story's pacing rules
- Per-NPC memories, written only for passages the NPC was present for
- Per-NPC "on their mind" line, rewritten when the NPC is present
- Story-level toggle plus per-character opt-in
- Inspector view and manual corrections on web and iOS
- MCP read and write

Not in v1: dice of any kind, daily events, schedules, relationships, reflection, intent agents, NPC profiles beyond the opt-in flag.

## Data

| Where | What |
|---|---|
| `stories.features_json` | `StoryFeatures` as JSON text. NULL parses as `{}`, meaning every feature off |
| `lorebook_entries.npc` | boolean, default false. Meaningful only for `category = "character"` |
| `world_patches` | `id`, `story_id`, `entry_id` (nullable), `source` (`world` / `manual`), `ops_json`, `created_at` |

- One `world` patch per entry at most (unique on `entry_id` where `source = 'world'`), so a re-run cannot double-apply.
- `entry_id` is the generated passage the patch belongs to. A manual patch takes the latest live generated passage, or NULL when the story has none.
- Memory ids are minted by whoever writes the op.

## Fold

State = apply ops in order, starting from `{ minutes: 0, npcs: {} }`.

- **Live patches only.** NULL-anchored patches always count. Others count only while their entry is live: not deleted, and the active take of its slot.
- **Order.** NULL-anchored first, then by entry position. Within an entry, the `world` patch always precedes its `manual` patches, regardless of `created_at`, so a correction made during a world pass keeps precedence. Manual patches sort by `created_at`, then id.
- **Ops.** `advance-clock` adds; `set-clock` replaces. `set-mind` replaces the line. `add-memory` appends with the current clock and the patch's entry, which is NULL for a NULL-anchored patch. `strike-memory` removes.
- **Opted-in NPCs.** Ops naming a lorebook entry that is deleted or no longer opted in are skipped. Every opted-in NPC appears in the output, empty if it has no state.

Undo, redo, retry, switch-take, and rewind need no journal changes, because they already change which entries are live. Editing a passage does not re-run its patch.

## World pass

- **When.** In `finishRun` next to `scheduleSummary`, only when a passage landed and `features.world.enabled`. Same contract as `summarize.ts` and `atmosphere.ts`: floated, never awaited, never throws into generation, and the next turn is the retry.
- **Queue.** Per-story requests run serially in manuscript order. Each drain also catches up at most four earlier live generated passages without world patches, oldest first. Recheck liveness and existing patches before each request.
- **Failure.** A failed pass stops the drain, so later passages are never computed on a gap. The next turn retries it first. Three failures in a row stop the story's passes until the summarizer settings change or the server restarts.
- **Model.** The summarizer's resolved model and key. Ledger kind `"world"`, a server-only `GenerationRequestKind`.
- **Present NPCs.** Opted-in, enabled character entries whose keys appear in the passage or in the player's turn that prompted it. Matching works the same way as lore triggers.
- **Input.** Pacing rules, current clock, the player's turn, the new passage, and for each present NPC its card content, mind, and most recent memories.
- **Output.** One JSON object, validated with zod:
  - `minutesElapsed`: integer, at least 0, following the pacing rules
  - `minuteOfDay`: optional integer from 0 to 1439. When the prefix has no clock op yet, infer the time of day at the end of the passage from its prose, or use 480 when there is no cue. The first patch uses `set-clock` with this value instead of `advance-clock`.
  - `npcs`: `[{ loreEntryId, mind, memories: [{ text, importance }] }]` for present NPCs only. Memories are first-person, specific, and limited to what that NPC saw or heard.
  - An invalid answer writes nothing.
- **Write.** One `world` patch on the passage, then commit through `commit.ts` so every device refetches. Capture the live prefix entry ids and folded patch ids at read time, then compare them under the story row lock before inserting. A mismatch writes nothing and requeues the passage once.

## Narrator context

When the feature is on, `composeContext` adds volatile blocks after volatile lore and before the author's note:

```
[World: day 3, evening]
[Lilveth, now]
On her mind: …
Remembers:
- (day 2) …
```

- **Clock line.** Always present while the feature is on. Time of day comes in buckets: night, morning, afternoon, evening.
- **NPC blocks.** One for each opted-in NPC whose lore entry is active this turn. At most 4, by lore priority.
- **Memories.** At most 6 per NPC, ranked by importance and then recency, printed oldest first.
- **Budget.** World blocks get at most an eighth of the context window. An NPC that does not fit loses its least important memories first, then its block. The clock line always stays.
- **Sanitized.** Names, minds and memories are flattened to one line, and brackets become parentheses, so model-written text cannot open a fake prompt section.
- **Volatile placement.** These blocks change every turn, so they never go in the cacheable head.
- **Breakdown.** `breakdown.ts` and the inspector context meter show a `world` section.

## Endpoints

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/stories/:storyId/world` | | `{ state }` |
| POST | `/api/stories/:storyId/world/patch` | `{ ops }` | `{ state }` |
| PATCH | `/api/stories/:storyId` | `{ features }` | existing story record, now with `features` |
| PATCH | `/api/lorebook/:entryId` | `{ npc }` | existing lore record, now with `npc` |

A manual patch made while a run is live gets refused with `conflict`. One that names an NPC that is not opted in, strikes a memory that is not in the current state, or reuses a memory id is refused with `invalid`.

## MCP

- `world_state`: read-only. Clock and every NPC's state.
- `world_patch`: a manual patch with the same ops and refusals as the POST route.
- `update_story`: gains `features`.
- `lore_write`: gains `npc`.

## Clients

Web and iOS show the same UI:

- **Story toggle.** "Living world" plus a pacing-rules field, in the inspector, grouped like the atmosphere controls.
- **Lore editor.** A "Living NPC" switch on character entries.
- **Inspector World section.**
  - The clock, as "Day 3 · evening", with a control to set day and time.
  - One row per NPC showing its name and its mind, with the mind editable.
  - Memories newest first, each with an importance mark and a strike action, plus an add field.
  - Hidden when the feature is off.
- **Context meter.** Shows the `world` section.

## Known limits

- **One server process.** The queue and breaker live in memory. Several server instances could each run, and bill, the same pass. The unique index keeps it from being applied twice.
- **Catch-up is capped.** Turning the feature on for a long story, or a long outage, leaves older passages without patches.
- **Prose edits.** Editing a passage, or the lore behind it, does not recompute its patch, even mid-pass.
- **Duplication.** A copy keeps feature flags and NPC opt-ins but starts with an empty world.
- **Strikes and takes.** A strike is sent once its Undo window ends. Switching takes before then attaches it to the new take.
