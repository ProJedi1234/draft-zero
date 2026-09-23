# Service conventions

The logic behind every write lives here, callable from a server action, a route handler, or an
MCP tool. `lib/services/lorebook*.ts` is the reference implementation. Copy its shape.

---

## 1. Files per resource

| File | Imports | Holds |
|---|---|---|
| `lib/services/<resource>.schema.ts` | `zod`, isomorphic modules only | Input schemas, output schemas, `z.input` types |
| `lib/services/<resource>.ts` | `"server-only"` first | One exported async function per operation |
| `lib/services/<resource>.test.ts` | `test-support.ts` | Spec against the fake db and the real bus |
| `lib/actions/<resource>.ts` | the service | `"use server"` wrappers, signatures unchanged |

Shared, already written: `result.ts`, `context.ts`, `schema.ts`, `commit.ts`,
`test-support.ts`.

`*.schema.ts` must never import a server module, `lib/db/*` included (type-only imports are
fine). A contract package lifts these files out later.

---

## 2. A service function

```ts
export async function updateThing(
  raw: UpdateThingInput,          // z.input<typeof updateThingInput>
  ctx: ServiceContext             // { origin }
): Promise<ServiceResult<{ record: Thing }>> {
  const parsed = parseInput(updateThingInput, raw)
  if (!parsed.ok) return parsed
  // ...the old action's body, unchanged in behavior...
  commitThing(record, ctx.origin)   // lib/services/commit.ts, after the commit
  return ok({ record })
}
```

A service that never reads `ctx` is a const of the shared type instead, so the parameter can be
omitted without an unused-argument lint while every caller still passes it:

```ts
export const deleteThing: Service<DeleteThingInput> = async (raw) => { ... }
```

- **Parse first, always.** The service is the trust boundary, because a server action is a
  public POST endpoint too.
- **One input object.** Positional arguments become named fields. Options that describe the
  caller (`origin`) go in `ctx`, never in the schema.
- **Keep the old error sentences.** `parseInput` returns the first issue's message, so order a
  schema's keys the way the old action checked them, and give each rule the old action's exact
  sentence. `entityId(message)` in `schema.ts` covers id checks.
- **Every failure carries a code.** Use `fail(code, error)`:

| Code | HTTP | When |
|---|---|---|
| `invalid` | 400 | Schema failure, or a rule the schema cannot state |
| `not_found` | 404 | The named row does not exist |
| `conflict` | 409 | Refused by current state, such as a write during a run (`refuseDuringRun`) |
| `failed` | 500 | A valid call the server could not finish (provider, storage) |

  A helper that still returns a bare `ActionResult` failure (no code) must be mapped at the
  call site, for example `const busy = refuseDuringRun(id); if (busy) return fail("conflict", busy.error)`.
- **Commit through `commit.ts`, after the transaction, never inside it.** That call is what
  keeps magic sync alive: it revalidates the PWA and publishes to the bus every device listens
  on. A service that skips it is a write other devices never hear about.
- **Behavior-preserving.** Same rows written, same bus events, same return data. Tighten
  validation only where the old type already promised it (an enum the UI always sends).

## 3. Schemas

- Input: `z.object`, with `.default()` where the old action used `??`.
- Output: the exact data shape returned. Mirror the domain type in `lib/types.ts`, but stay
  permissive where a legacy row could violate a stricter rule (the lorebook `category`).
- Export `z.input` types for inputs. Services return the existing domain types, not `z.infer`.
- Reads that the PWA already gets from `/api/store/snapshot` and `/api/story/:id/workspace` do
  not need services. Reads the actions expose (paging, lookups) do.

## 4. The action wrapper

```ts
"use server"
export async function updateThing(id: string, patch: ThingPatch, options: Origin = {})
  : Promise<ActionResult<{ record: Thing }>> {
  return things.updateThing({ id, patch }, { origin: options.origin ?? null })
}
```

Keep the exported name, parameters, and declared return type identical. 32 components and the
client store call these, and their test doubles are typed against them.

⚠️ A `"use server"` file exports async functions and erased type declarations
(`export interface`, `export type X =`) — **never an export list** such as `export type { X }`,
and no constants. Next's action compiler turns an export list into action references, so a type
re-export becomes a runtime lookup that breaks every action in the app, and tsc and bun both
accept it. Import shared types from the `*.schema.ts` module. `tests/use-server-exports.test.ts`
enforces this.

## 5. Tests

⚠️ **Never `mock.module` anything under `lib/services/`.** Bun's `mock.module` is
process-global. A double of a service or of `commit.ts` in one spec replaces the real module for
every spec in the run, and the service's own spec then tests the double. To test a consumer (an
MCP tool, an action), run the real service over the fake db, or double a module *below* the
service.

- `installFakeDb()` doubles `@/lib/db/client`, `next/cache`, and `server-only`. Call it before
  importing the service. `db.next(rows)` scripts the next awaited statement,
  `db.statements` and `db.argsOf(i, method)` show what ran, and `db.revalidated` lists
  revalidated paths.
- `captureBus()` subscribes to the real bus. Assert the exact events every write publishes.
  This is the test that proves magic sync still hears the write.
- `lib/mcp/tools/test-queries.ts` doubles `@/lib/db/queries` for the whole process, with every
  export present. A read nobody stubbed throws when called, so a service spec that reaches one
  should call `installQueryMocks()` and `stubQueries({...})` in `beforeEach`.
- Any other `mock.module` double must declare **every** export of its module, stubbing the
  unused ones. A missing name is a `SyntaxError` in whichever spec imports it next
  (see the `@/lib/db/entry-writes` doubles in `tests/`).
- The run registry (`lib/generation/live.ts`) is process-global too, and a deleted story's id
  stays tombstoned there. A spec that calls `reserveRun` uses a story id no other spec uses, and
  asserts the reservation took: `expect(reserveRun(STORY)).toBe(true)`.
- `tests/generation-stream.test.ts` leaves a fake OpenRouter key registered for the rest of the
  run. A spec whose service can reach the model catalog or any OpenRouter call doubles
  `@/lib/generation/key` to return null, or the call below the service. `bun test` must pass
  with no network.
- A spec that runs the real entries service calls `installEntriesDoubles()` from
  `entries-test-support.ts`, which restores the real `@/lib/db/entry-writes`.
- Cover, per operation: the success path's writes and bus events, each validation sentence
  with code `invalid`, and `not_found` or `conflict` where the operation can produce them.
