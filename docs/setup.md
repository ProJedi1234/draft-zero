# Setup

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

## Environment

`.env.example` documents every variable. The ones you are likely to touch:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | the Postgres to open; defaults to the compose stack on 5433 |
| `OPENROUTER_API_KEY` | optional — overrides the key saved on the Settings page. With neither, generation runs on the offline mock provider |
| `MCP_ALLOWED_HOSTS` | extra hostnames `/api/mcp` answers to beside localhost |
| `DRAFT_ZERO_DEV_ORIGINS` | extra origins the dev server trusts, so HMR works from a phone on your LAN |
| `DRAFT_ZERO_TIME_ZONE` / `DRAFT_ZERO_LOCALE` | the day boundary and date format on the usage page |

## Docker

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

`Dockerfile.prod` builds the production bundle; `compose.lan.yaml` publishes
the stack on the LAN for testing from a phone.

## Database

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

Generated pictures are not in Postgres. The bytes land under `.data/images/`
beside the database row and are served by `/api/images/[id]`, so back that
directory up with the database.

## Scripts

| Command | Does |
|---|---|
| `bun run dev` | dev server |
| `bun run build` / `start` | production build / serve |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run lint` | eslint |
| `bun run format` | prettier |
| `bun test` | the test suite |
| `bun run db:generate` / `db:migrate` / `db:seed` | schema workflow (above) |

CI runs tests, format check, lint, types and a production build on every push
and pull request.

## Layout

- `app/` — routes: `/` (the library), `/story/[storyId]`,
  `/story/[storyId]/lorebook`, `/gallery`, `/usage`, `/settings`; `app/api/`
  holds the streaming and sync channels, the image routes and `/api/mcp`
- `components/` — `ui/` is shadcn-generated, never hand-edited; the rest is
  grouped by surface (`story/`, `inspector/`, `lorebook/`, `library/`,
  `settings/`, `gallery/`, `sidebar/`)
- `hooks/` — client hooks, including the server-synced controls that make
  magic sync work
- `lib/db/` — `schema.ts` (Drizzle tables), `client.ts` (pool), `queries.ts`
  (reads), `mappers.ts` (row → domain)
- `lib/actions/` — server actions (the only writers)
- `lib/generation/` — provider interface + mock provider, context assembly,
  the summarizer and the atmosphere picker, plus the two OpenRouter catalogs:
  `models.ts` (every model) and `endpoints.ts` (who serves one model)
- `lib/images/` — the image side: catalog, prompt development, the
  server-owned draw and derive runs, and the on-disk blob store
- `lib/store/` — the client store: optimistic writes, rollback, persistence
- `lib/sync/` — the magic-sync wire contract and client
- `lib/mcp/` — the MCP server and its tools; `CONVENTIONS.md` is the contract
  between them
- `lib/import/` — `novelai.ts` reads NovelAI `.scenario` files, `aidungeon.ts`
  reads AI Dungeon story-card exports, `aidungeon-backup.ts` reads AI Dungeon
  backup archives on top of the dependency-free `zip.ts`
- `lib/story/` — `action-voice.ts` turns a player action into prose
- `docs/` — this directory; `MILESTONE2.md` predates the Postgres move
