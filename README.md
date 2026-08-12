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

**Migrations are not applied automatically.** `getDb()` only connects; it never
migrates. Against a shared server, two app instances racing `migrate()` corrupt
the migration bookkeeping, so schema changes are an explicit step:

```bash
bun run db:generate   # write a migration from lib/db/schema.ts changes
bun run db:migrate    # apply pending migrations
```

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
- `lib/generation/` — provider interface + mock provider
- `lib/import/` — `novelai.ts` reads NovelAI `.scenario` files (see below)
- `docs/` — milestone specs; `MILESTONE2.md` predates the Postgres move

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
