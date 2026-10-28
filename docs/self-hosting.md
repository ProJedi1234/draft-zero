# Self-hosting

Every [release](https://github.com/ProJedi1234/draft-zero/releases) publishes a
multi-arch image (amd64 and arm64) and attaches the two files needed to run it.

| Artifact | Where |
|---|---|
| Image | `ghcr.io/projedi1234/draft-zero:<version>`, also `:<major>.<minor>` and `:latest` |
| `compose.yaml` | release asset, pinned to that release's image |
| `env.example` | release asset, every variable the stack reads |

Prereleases publish only their full version tag and never move `latest`.

## Run a release

Requires Docker with Compose 2.24 or later.

```bash
mkdir draft-zero && cd draft-zero
# download compose.yaml and env.example from the release into this directory
mv env.example .env       # set POSTGRES_PASSWORD, letters and digits only
docker compose up -d
```

Open http://localhost:3000. The stack is Postgres 17, a one-shot `migrate`
service, and the app. The app waits for `migrate` to exit cleanly, so it never
starts against a stale schema.

**The app has no login.** It listens on `127.0.0.1:3000` by default. Anyone who
can reach the port can read every story and spend the saved OpenRouter key.
Set `DRAFT_ZERO_BIND` (for example `0.0.0.0:3000`) only on a network you trust
or behind a proxy that authenticates.

## Upgrade

Download the newer release's `compose.yaml` over the old one, then:

```bash
docker compose pull
docker compose up -d
```

`migrate` applies any new migrations before the app restarts. Migrations only
move forward, so back up before upgrading if you might roll back:

```bash
docker compose exec postgres pg_dump -U draft_zero -Fc draft_zero > draft-zero.dump
```

## Data

| Volume | Holds |
|---|---|
| `postgres-data` | stories, lorebooks, settings, the spend ledger |
| `app-data` | generated pictures, unless the `DRAFT_ZERO_IMAGES_S3_*` variables move them to a bucket |

`docker compose down` keeps both. `docker compose down -v` deletes them.
