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
| Dev (shared) | the shared `devpg` container on `127.0.0.1:5432` | the older convention, still usable — see below |
| Prod (hestia) | `clio` — `192.168.0.199:5432` | Postgres 17 |

Compose uses **5433** so it coexists with `devpg`, which already owns 5432 on
argos. To use `devpg` instead, create the role and database there once and
point `DATABASE_URL` at `:5432`:

```bash
docker exec devpg psql -U postgres \
  -c "CREATE ROLE draft_zero LOGIN PASSWORD '<password>';" \
  -c "CREATE DATABASE draft_zero OWNER draft_zero;"
```

`devpg` is Postgres 18 while compose and clio are 17 — nothing in the schema
uses 18-only features, but generate migrations against the older target if that
ever changes.

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
- `lib/import/` — `novelai.ts` reads NovelAI `.scenario` files (see below)
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

## Importing NovelAI scenarios

The upload icon beside the sidebar's Library heading takes a NovelAI
`.scenario` file and turns it into a story: prompt → the opening passage,
`context[0]`/`context[1]` → memory and author's note, tags → genre, and the
scenario's lorebook → that story's lorebook. `${…}` placeholders are collected
into the import dialog and filled before anything is written.

Not imported: NovelAI's model, repetition penalties and `max_length` (its
sampler has no OpenRouter equivalent — temperature and top-p carry over), user
scripts, ephemeral context, phrase-bias and banned-sequence groups. Regex
lorebook keys are flattened to plain text, since trigger matching here is
substring-only. The dialog lists whatever it dropped before you commit.
