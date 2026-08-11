import fs from "node:fs"

import { defineConfig } from "drizzle-kit"

/**
 * drizzle-kit runs under Node, which does not read .env.local on its own — and
 * `bun run` loads .env.local into its own process but does NOT forward it to
 * spawned binaries. `next dev` and `bun scripts/seed.ts` both get it for free;
 * this config is the one place that has to read the file itself.
 */
function urlFromEnvFile(): string | undefined {
  for (const file of [".env.local", ".env"]) {
    if (!fs.existsSync(file)) continue
    const match = fs
      .readFileSync(file, "utf8")
      .match(/^\s*DATABASE_URL\s*=\s*(.*)$/m)
    if (match) return match[1].trim().replace(/^["']|["']$/g, "")
  }
  return undefined
}

const url = process.env.DATABASE_URL ?? urlFromEnvFile()

if (!url) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env.local (see README)."
  )
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url },
})
