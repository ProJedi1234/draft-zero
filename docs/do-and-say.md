# Do and Say

The composer offers exactly two moves. You write in first person — *shove the
door with my shoulder*, or *who's down there?* — and the passage lands on the
page in second: a Do becomes `You shove the door with your shoulder.` and a Say
becomes `You say, "Who's down there?"`. Writing "I" and reading "you" is the
natural way to play, and it keeps the manuscript in one consistent voice no
matter which passage came from whom. Free-form Story mode and Instruction mode
are gone. An instruction has no replacement — it was ephemeral direction to the
model, never rendered, whereas a Do is a permanent second-person passage in the
manuscript: *focus on the horror atmosphere* as a Do writes the sentence `You
focus on the horror atmosphere.` into the prose. Standing direction belongs in
Memory or the author's note now.

The translation is `translateAction()` in `lib/story/action-voice.ts` — a pure,
deterministic, isomorphic function, with no model call behind it. Do rewrites
first-person pronouns but leaves anything inside double quotes alone, so quoted
dialogue keeps its own "I"; it then fixes `be` agreement and prefixes `You `.
Say does not touch pronouns at all: it unwraps the quotes, strips a speech-act
preamble like *I tell her,*, and wraps what is left as spoken dialogue.

Entries store both halves. `input_text` is the raw first-person text as typed,
`action_kind` is `say` or `do`, and the entry's content is the translated
prose. Keeping the input means an edit or a re-run can retranslate from the
source rather than parse finished prose back apart. Both columns are nullable,
and NULL for both means "not a player action" — every generated passage, every
user passage written before this feature, and the opening passage the NovelAI
importer writes. Those render verbatim, exactly as they always did; there is no
backfill.
