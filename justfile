# justfile — the short commands for everyday work. `just` on its own lists them.
#
# Thin on purpose: every recipe below is a wrapper over `bun run …` or
# `docker compose …`, never a reimplementation. package.json stays the source of
# truth for what a step *is*; this file only records which steps go together.
#
# One trap worth knowing: compose.yaml pins `name: draft-zero`, so the db
# recipes here drive the ONE shared stack no matter which worktree you run them
# from. From a branch worktree that means taking over the base stack rather than
# sitting beside it — give a throwaway stack its own project name, volume and
# ports in a compose file kept OUTSIDE the repo if you need both at once.

# .env.local is what next dev and scripts/*.ts already read; loading it here
# means `just db-url` reports the same database they will actually open.
set dotenv-load := true
set dotenv-filename := ".env.local"
set shell := ["bash", "-uc"]

[private]
default:
    @just --list --unsorted

# ── everyday ────────────────────────────────────────────────────────────────

# A no-op install costs ~20ms, so every recipe that runs project code depends
# on this rather than letting a stale node_modules surface later as a
# missing-module stack trace from next or drizzle-kit.

# Sync node_modules with package.json and bun.lock.
[group('everyday')]
deps:
    bun install

# First run on a fresh clone: database, deps, .env.local, schema.
[group('everyday')]
setup: db-up deps
    @test -f .env.local || { cp .env.example .env.local; echo "wrote .env.local"; }
    bun run db:migrate
    @printf "\nready — 'just dev' to start\n"

# Apply pending migrations, then the dev server (HMR, host toolchain).
[group('everyday')]
dev: deps migrate
    bun run dev

# Production build served locally: build, migrate, start.
[group('everyday')]
serve: build migrate
    bun run start

# Production build only.
[group('everyday')]
build: deps
    bun run build

# The pre-PR gate: types, lint, format and tests.
[group('everyday')]
check: deps
    #!/usr/bin/env bash
    # All four run even when one fails: a round trip that reports every problem
    # beats one that stops at the first.
    fail=0
    for step in typecheck lint format:check; do
        echo "── $step"; bun run "$step" || fail=1
    done
    echo "── test"; bun test || fail=1
    exit $fail

# Fix what `check` can fix by itself.
[group('everyday')]
fix: deps
    bun run format
    bun run lint --fix

# ── database ────────────────────────────────────────────────────────────────

# Start Postgres (compose, 127.0.0.1:5433) and wait for it to accept queries.
[group('database')]
db-up:
    docker compose up -d --wait postgres

# Which database will the tooling actually open?
[group('database')]
db-url:
    @just _resolve-db

# Apply pending migrations.
[group('database')]
migrate: deps
    bun run db:migrate

# Write a migration from lib/db/schema.ts changes.
[group('database')]
generate: deps
    bun run db:generate

# DESTRUCTIVE: wipe every story, entry, lorebook entry and setting, reload fixtures.
[group('database')]
seed: deps
    @just _confirm-db "reseed"
    bun run db:seed

# DESTRUCTIVE: drop the compose data volume. 'just setup' rebuilds from empty.
[group('database')]
nuke:
    @just _confirm-volume
    docker compose down -v

# A psql shell on the compose database.
[group('database')]
psql:
    docker compose exec postgres psql -U draft_zero -d draft_zero

# ── docker ──────────────────────────────────────────────────────────────────

# The whole stack in Docker: Postgres, migrate one-shot, then next dev on :3000.
[group('docker')]
up:
    docker compose --profile app up --build

# Same, published to the LAN on :3001 for phone and iPad testing.
[group('docker')]
lan:
    docker compose -f compose.yaml -f compose.lan.yaml --profile app up -d --build

# Stop the stack, keeping data.
[group('docker')]
down:
    docker compose down

# Follow the stack's logs.
[group('docker')]
logs:
    docker compose logs -f

# ── guards ──────────────────────────────────────────────────────────────────
#
# Destructive recipes name their target before asking. The compose Postgres on
# 5433 is throwaway; the shared devpg on 5432 holds real work from every project
# on this box and has no backup, so the two must never be confused.

[private]
_resolve-db:
    #!/usr/bin/env bash
    url="${DATABASE_URL:-}"
    if [[ -z "$url" ]]; then
        echo "DATABASE_URL is unset and .env.local is missing — see README." >&2
        exit 1
    fi
    safe="${url/:\/\/*@/://…@}"
    case "$url" in
        *@127.0.0.1:5433/*|*@localhost:5433/*) where="the throwaway compose Postgres — safe to destroy" ;;
        *@127.0.0.1:5432/*|*@localhost:5432/*) where="the SHARED devpg — real work from every project on argos, no backups" ;;
        *) where="an unrecognised target — check it by hand" ;;
    esac
    echo "$safe"
    echo "  → $where"

[private]
_confirm-db action:
    #!/usr/bin/env bash
    just _resolve-db
    read -r -p "$(printf '\n%s this database? [y/N] ' "{{action}}")" reply < /dev/tty
    [[ "$reply" == [yY] ]] || { echo "aborted"; exit 1; }

[private]
_confirm-volume:
    #!/usr/bin/env bash
    echo "drops the compose volume draft-zero_postgres-data (5433 stack only)"
    read -r -p "destroy it? [y/N] " reply < /dev/tty
    [[ "$reply" == [yY] ]] || { echo "aborted"; exit 1; }
