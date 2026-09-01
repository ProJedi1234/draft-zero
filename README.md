# draft-zero

A local-first, AI-assisted novel-writing app. Next.js 16 App Router, React 19,
Tailwind v4, shadcn/base-sera on `@base-ui/react`, Drizzle ORM on Postgres.

## Setup

Requires bun and Docker. Nothing here needs editing — the `.env.example`
defaults already match the Postgres in `compose.yaml`.

```bash
docker compose up -d         # Postgres 17 on 127.0.0.1:5433
bun install
cp .env.example .env.local
bun run db:migrate           # create/update the schema
bun run db:seed              # optional: destructive reseed with fixtures
bun run dev
```

With [`just`](https://just.systems) installed (`apt install just`) that whole
block is `just setup`, and `just` on its own lists every shortcut. The
`justfile` only records which `bun run` and `docker compose` steps go together —
package.json stays the source of truth for what each step is, so nothing here
requires it.

| Recipe | Runs |
|---|---|
| `just setup` | the block above, on a fresh clone |
| `just dev` | `db:migrate`, then the dev server |
| `just serve` | `build`, `db:migrate`, `start` |
| `just check` | typecheck, lint, format, tests — the pre-PR gate |
| `just up` / `lan` | the full Docker stack on `:3000` / the LAN on `:3001` |
| `just db-url` | which database the tooling will actually open |

`db:seed` and `docker compose down -v` are wrapped as `just seed` and `just
nuke`, which name the target database and wait for a `y` first. That guard
exists because `.env.local` is easy to point at a Postgres you share with
other projects on 5432, where a reseed destroys real work — see the database
table below.

To run the app in Docker too — same stack, plus `next dev` on port 3000:

```bash
docker compose --profile app up --build
```

The app service is behind a profile because the host dev server has faster HMR
and a working editor toolchain; plain `docker compose up` stays Postgres-only.
Source is bind-mounted, so edits still hot-reload, but `node_modules` and
`.next` are container-local volumes and the two dev servers do not share them.

That profile also brings up a one-shot `migrate` service, which the app waits on
(`service_completed_successfully`), so the Docker path never serves a stale
schema and a failed migration stops the stack instead of being buried in
dev-server logs. To apply migrations without starting the app — handy for the
host-dev path, or on a machine with no bun installed:

```bash
docker compose run --rm migrate
```

`run` ignores profiles, so that works from a plain `docker compose up -d` stack.

`Dockerfile.dev` is a Node base with the bun binary copied in, not the
`oven/bun` image: bun is the package manager and script runner, but Next has to
run under real Node. `oven/bun`'s `node` is a bun shim, and under it Turbopack
fails to load external packages (`Failed to load external module pg-<hash>`)
even though they are present in `node_modules`.

### Database

| Environment | Where | Notes |
|---|---|---|
| Dev (compose) | `compose.yaml` — `127.0.0.1:5433` | Postgres 17, credentials hardcoded (`draft_zero`/`draft_zero`); throwaway, bound to loopback only |
| Dev (existing server) | whatever you already run on `127.0.0.1:5432` | usable instead of compose — see below |
| Prod | wherever you deploy it | Postgres 17 |

Compose uses **5433** so it coexists with any Postgres already on the default
port rather than fighting it for one. To use that one instead, create the role
and database there once and point `DATABASE_URL` at `:5432`:

```bash
psql -U postgres \
  -c "CREATE ROLE draft_zero LOGIN PASSWORD '<password>';" \
  -c "CREATE DATABASE draft_zero OWNER draft_zero;"
```

Generate migrations against the oldest Postgres you target. Nothing in the
schema needs anything newer than 17, so running a later release day-to-day is
fine — but the generated SQL is what has to apply everywhere, so the version it
was written against is the one that matters.

`docker compose down -v` drops the data volume, which is the fastest way back
to a clean database (`db:migrate` and `db:seed` to refill it).

**The app never migrates itself.** `getDb()` only connects; it never calls
`migrate()`. Against a shared server, two app instances racing `migrate()`
corrupt the migration bookkeeping, so applying migrations stays a separate step
with exactly one runner:

```bash
bun run db:generate   # write a migration from lib/db/schema.ts changes
bun run db:migrate    # apply pending migrations
```

Writing a migration is always manual. Applying one is automatic *only* under
`docker compose --profile app up`, where the `migrate` service is that single
runner and finishes before the app starts. Re-running it costs one query —
`drizzle-kit migrate` is a no-op when `__drizzle_migrations` is already current
— so it runs on every `up` rather than trying to detect whether it is needed.

`next dev`/`next build` and `bun scripts/*.ts` read `.env.local` automatically.
`bun run` does *not* forward it to spawned binaries, so `drizzle.config.ts`
reads the file itself — drizzle-kit needs no flags.

## Scripts

| Command | Does |
|---|---|
| `bun run dev` | dev server |
| `bun run build` / `start` | production build / serve |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run lint` | eslint |
| `bun run format` | prettier |
| `bun run db:generate` / `db:migrate` / `db:seed` | schema workflow (above) |

## Layout

- `app/` — routes: `/` (redirects to the newest story), `/story/[storyId]`, `/lorebook`, `/settings`
- `components/` — `ui/` is shadcn-generated, never hand-edited
- `lib/db/` — `schema.ts` (Drizzle tables), `client.ts` (pool), `queries.ts` (reads), `mappers.ts` (row → domain)
- `lib/actions/` — server actions (the only writers)
- `lib/generation/` — provider interface + mock provider, plus the two OpenRouter
  catalogs: `models.ts` (every model) and `endpoints.ts` (who serves one model)
- `lib/import/` — `novelai.ts` reads NovelAI `.scenario` files, `aidungeon.ts`
  reads AI Dungeon story-card exports, `aidungeon-backup.ts` reads AI Dungeon
  backup archives on top of the dependency-free `zip.ts` (see below)
- `lib/story/` — `action-voice.ts` turns a player action into prose (see below)
- `docs/` — milestone specs; `MILESTONE2.md` predates the Postgres move

### Do and Say

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

### Provider routing

Under the model picker sits a provider picker: which upstream host actually
serves the model. Most open-weights models are served by several, and they are
not interchangeable — the same weights can differ by an order of magnitude in
output speed and by half in price, and a third-party host often serves a shorter
context window than the lab does. So each row in the menu carries the numbers the
choice turns on: median tokens/sec over the last half hour, price in/out per 1M,
window, and quantization, with uptime shown only when it is bad enough to be a
reason against.

**Auto** is the default and the top row — OpenRouter's own ranking, which is the
right answer until you have a reason it isn't. A pinned provider is stored on the
story as `provider_tag` (NULL is Auto) and sent as `provider.only` with fallbacks
off: pinning a provider and silently being served by another would make the
picker a decoration. Tags are model-specific, so switching models resets the pin,
and a tag that has since left the model's endpoint list falls back to Auto rather
than failing the request. When a pinned endpoint has a shorter window than the
model, that shorter window becomes the context ceiling.

## Importing

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
