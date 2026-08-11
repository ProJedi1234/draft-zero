# draft-zero

A local-first, AI-assisted novel-writing app. Next.js 16 App Router, React 19,
Tailwind v4, shadcn/base-sera on `@base-ui/react`, Drizzle ORM on Postgres.

## Setup

Requires bun and a reachable Postgres (17+).

```bash
bun install
cp .env.example .env.local   # then edit DATABASE_URL
bun run db:migrate           # create/update the schema
bun run db:seed              # optional: destructive reseed with fixtures
bun run dev
```

### Database

| Environment | Where | Notes |
|---|---|---|
| Dev (argos) | the shared `devpg` Docker container on `127.0.0.1:5432` | one database + owner role per app, following the existing convention |
| Prod (hestia) | `clio` — `192.168.0.199:5432` | Postgres 17 |

Create the dev database and role once:

```bash
docker exec devpg psql -U postgres \
  -c "CREATE ROLE draft_zero LOGIN PASSWORD '<password>';" \
  -c "CREATE DATABASE draft_zero OWNER draft_zero;"
```

`devpg` is Postgres 18 and clio is 17 — nothing in the schema uses 18-only
features, but generate migrations against the older target if that ever changes.

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
- `docs/` — milestone specs; `MILESTONE2.md` predates the Postgres move
