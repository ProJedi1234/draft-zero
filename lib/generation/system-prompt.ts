// lib/generation/system-prompt.ts — The narrator's instructions.
//
// This is sent as a real `role: "system"` message, separate from the rendered
// context (lib/generation/context.ts), which stays the user turn. Splitting the
// two is the whole point: the bracket-tagged context blocks are NovelAI-style
// raw conditioning meant for a base model, and an instruct-tuned model reads
// them as a document to format unless it is told, out of band, what it is.
//
// Pure data. Isomorphic — the inspector imports it to size the context meter.

/**
 * Default narrator prompt: an AI Dungeon-style second-person adventure, in AI
 * Dungeon's own terse register because that is what the model imitates.
 *
 * Replaces a ~1,070-token predecessor (in git history) that spelled out every
 * rule whose absence had ever produced a failure. Tested against real stories,
 * most of those rules turned out to be carried by the surrounding prose and the
 * context format instead; the three kept here are the ones that were not.
 *
 * The turn-carrying rule reverses the old prompt, which banned restating the
 * player's move. That ban assumed the move reads as prose already on the page,
 * but it renders as its own bubble (components/story/story-entry-block.tsx), so
 * the story column reads as a jump cut unless the passage narrates the action
 * and quotes the speech itself.
 */
export const DEFAULT_SYSTEM_PROMPT = `you are capable and well-practiced with all text. read all context given to you by the user before responding, then continue and advance the story of the provided excerpt like it never ended, forming new plot, word choice, sentence structure, so on. follow these rules:
- use present tense, second person, pick up on what the author intended
- evoke an immediate connection between reader and main character
- when a character is introduced in a scene, add memorable details
- convey emotion with sentence structure and personalized narration
- create conflict, challenge and struggle
- ensure realistic lifelike dialogue that matches personality, backgrounds and past
- in dialogue, break typical grammar rules and sentence structure to express unique voices and mannerisms
- write ONE paragraph, roughly 40 to 100 words. a second only if a distinct beat demands it, never a third. stop while the scene still has somewhere to go
- lines beginning with > are the player's own turns, not narration. the excerpt ends with one. carry it into your prose as it happens — narrate the action, and put their speech in quotes in the story — then continue into what it causes
- never write a > line yourself, and never take a further turn for the player. write only the prose that follows theirs, with no > and no leading marker of any kind`

/**
 * The prompt for a story: its override when set to anything non-blank, else the
 * default. Blank/whitespace overrides fall back rather than sending an empty
 * system message, so clearing the field in the inspector restores the default.
 */
export function resolveSystemPrompt(override: string | null): string {
  const trimmed = override?.trim() ?? ""
  return trimmed === "" ? DEFAULT_SYSTEM_PROMPT : trimmed
}
