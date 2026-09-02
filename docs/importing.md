# Importing

The upload icon beside the sidebar's Library heading takes a NovelAI
`.scenario`, an AI Dungeon story-card export, or an AI Dungeon backup `.zip`.
The picker sniffs the file rather than asking which one you have: an archive is
recognised by its magic bytes, and the two `.json` formats are offered to each
reader in turn — each reports whether it *recognises* a file separately from
whether it could *read* it, and the first to claim it wins.

**NovelAI `.scenario`** becomes a story: prompt → the opening passage,
`context[0]`/`context[1]` → memory and author's note, tags → genre, and the
scenario's lorebook → that story's lorebook. `${…}` placeholders are collected
into the import dialog and filled before anything is written.

**AI Dungeon story cards** are lore rather than a scenario — often a bare JSON
array with no prompt at all — so they import two ways:

- from the sidebar, as a new story whose lorebook is the cards
- from a story's lorebook, merging into what is already there

A card's `type` is free text, not an enum: AI Dungeon's UI title-cases it and
lets writers invent their own, so the reader folds case and punctuation, matches
a table of the known vocabulary, and falls back to keyword matching before the
`concept` catch-all — reporting every guess it makes.

A `worldDescription` card is the setting bible rather than lore. Importing as a
new story seeds `memory` with it; merging into an existing story leaves that
story's memory alone and writes it as an always-active entry instead. Exactly
one copy is kept either way.

On a merge, a card whose name the story already holds is **skipped** and
counted — never overwritten, never duplicated. Cards that collide only with each
other are all kept, the same as the new-story path.

**AI Dungeon backups** are the whole adventure rather than a world: the archive
carries `metadata.json` (the adventure, its story cards and its state) beside
`actions-NNN.json` parts holding every action ever taken. It imports as a new
story with the manuscript already in it — the story cards go through the same
reader as a card export, and the actions become passages:

| Action | Becomes |
|---|---|
| `start`, `story` | a passage you wrote |
| `continue` | a generated passage |
| `do`, `say` | a player turn, chevroned at prompt time like any other |
| `see` | dropped — a backup carries the image prompt, not the image |

AI Dungeon stores a player turn **already rendered** (`> You open the door.`),
not as the first-person line you typed, so the input is reconstructed from the
rendering — the chevron comes off, a Say's quoted line is unwrapped back to what
was said — and run through the same `translateAction` the composer uses. An
imported turn is byte-identical to one typed here, and stays re-editable as a
Say or a Do.

The adventure's memory — AI Dungeon's Plot Essentials — becomes the story's
memory, and its author's note and tags carry over. AI Dungeon's own rolling
summary is adopted as the story's first recap version, so a long adventure
arrives with its context already caught up.

**AI instructions replace the narrator prompt.** That is what AI Dungeon writes
them as, so that is where they land — `stories.system_prompt`, which is a
whole-prompt override. A backup carrying instructions therefore also drops the
built-in prompt, including the rules that explain what a `>` player turn is.
That is deliberate for now: the Narrator dialog shows exactly what was stored,
with the built-in prompt as its placeholder, so it can be edited or cleared. The
real fix is a split in the prompt itself — the creative direction an import may
replace, apart from the mechanics of this app that it never should.

`state.memories` is **not** imported. It is AI Dungeon's own recall store —
entries it writes and retrieves as the adventure runs — and nothing here behaves
like that. Appending them to memory would turn entries meant to be retrieved
into standing context injected into every prompt, which is the one property the
store exists not to have. The dialog says how many were dropped.

Backups cross the wire as the archive itself rather than as inflated JSON, which
is what keeps a long adventure inside a Server Action body. `lib/import/zip.ts`
is a small stored/deflate reader built on `DecompressionStream`, so the same
bytes parse in the browser for the preview and on the server for the write; it
refuses ZIP64, encryption and split archives by name rather than misreading
them.

Not imported: NovelAI's model, repetition penalties and `max_length` (its
sampler has no OpenRouter equivalent — temperature and top-p carry over), user
scripts, ephemeral context, phrase-bias and banned-sequence groups. Regex
lorebook keys are flattened to plain text, since trigger matching here is
substring-only. The dialog lists whatever it dropped before you commit.
