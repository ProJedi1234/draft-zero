// tests/use-server-exports.test.ts — a "use server" module may export async
// functions, plus type declarations the compiler erases. Next's action compiler
// turns an export *list* into action references, so `export type { X }` becomes
// a runtime lookup of X that breaks every action in the app; tsc and bun both
// accept it.
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, test } from "bun:test"

const DIR = join(import.meta.dir, "..", "lib", "actions")

const files = readdirSync(DIR)
  .filter((name) => name.endsWith(".ts"))
  .map((name) => ({ name, source: readFileSync(join(DIR, name), "utf8") }))
  .filter(({ source }) => /^\s*["']use server["']/.test(source))

describe('"use server" modules', () => {
  test("there are some to check", () => {
    expect(files.length).toBeGreaterThan(0)
  })

  for (const { name, source } of files) {
    test(`${name} exports only async functions and type declarations`, () => {
      const exports = source.match(/^export\s+.*$/gm) ?? []
      const offending = exports.filter(
        (line) =>
          !/^export\s+async\s+function\s/.test(line) &&
          !/^export\s+(interface|type\s+\w+)\b/.test(line)
      )
      expect(offending).toEqual([])
    })
  }
})
