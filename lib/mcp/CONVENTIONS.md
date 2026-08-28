# MCP conventions

Written 2026-08-28 against **`@modelcontextprotocol/server@2.0.0`** (published 2026-07-27), by
reading the installed `.d.mts` and by running every flow below against the real handler. Where
this file and `MCP_PLAN.md`'s "SDK v2 notes" disagree, **this file is right** — the plan was
written from docs. Corrections are called out as ⚠️.

Read this before writing a tool. It is the contract between the eleven `lib/mcp/tools/*.ts`
modules; `server.ts`, `helpers.ts` and `app/api/mcp/route.ts` are shared and already written.

---

## 1. What is already wired

| File | Owner | What it does |
|---|---|---|
| `app/api/mcp/route.ts` | shared | One module-scope `createMcpHandler`, exported as POST/GET/DELETE. `runtime = "nodejs"`. |
| `lib/mcp/server.ts` | shared | Per-request `McpServer` factory; the fixed registrar order; `tools/list` cache hint; the `requestState` codec. |
| `lib/mcp/helpers.ts` | shared | `structured`, `failed`, `runTool`, pagination, position ranges, compact formatters. |
| `lib/mcp/tools/*.ts` | one bundle each | Tool declarations and handlers. **Your file.** |

To add a tool that is not in the plan's 14, you must edit `server.ts` — coordinate first. To
implement one that is, you only edit your own file.

Packages installed for this: `@modelcontextprotocol/server@2.0.0` (pulls
`@modelcontextprotocol/core`) and `zod@4.4.3` as a direct dependency.

---

## 2. Registering a tool

`server.tool(...)` does not exist. ⚠️ The plan's `server.tool(name, {...}, handler)` is v1. The
real method is **`registerTool`**, and its schemas are Standard Schema values — a `z.object(...)`,
not a raw `{ field: z.string() }` shape (the raw-shape overload still compiles but is deprecated).

```ts
import { z } from "zod"

import { runTool, structured, type RegisterTool } from "@/lib/mcp/helpers"

const inputSchema = z.object({
  storyId: z.string(),
  limit: z.number().int().min(1).max(100).optional().describe("Max entries. Default 10."),
})

const outputSchema = z.object({
  entries: z.array(z.object({ position: z.number().int(), text: z.string() })),
  hasMore: z.boolean(),
})

export const registerRead: RegisterTool = (server, deps) => {
  server.registerTool(
    "read",
    {
      title: "Read passages",           // human label for a UI
      description: "…",                 // what the client MODEL reads. See §7.
      inputSchema,
      outputSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args, ctx) =>
      runTool("read", async () => {
        // args is typed from inputSchema — no parse call, the SDK validated it.
        return structured(`positions 204–213 · 10 entries`, { entries, hasMore })
      }),
  )
}
```

`RegisterTool` is `(server: McpServer, deps: ToolDeps) => void`. Export one registrar per tool
even when two tools share a file (`lore.ts`, `story-crud.ts` do) — `server.ts` orders registrars,
not files.

`.describe()` on a field becomes the JSON Schema `description` the model reads. Use it for
anything non-obvious: what a default is, what units are, which other tool produces this value.

### Annotations that matter

`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint` — all optional booleans.
Set `readOnlyHint: true` on every read tool and `destructiveHint: true` on `edit`, `rewind` and
`delete_story`. Clients gate confirmation prompts on these.

---

## 3. Returning a result

A handler returns `CallToolResult`: `{ content: ContentBlock[], structuredContent?, isError? }`.

**Declaring `outputSchema` makes `structuredContent` mandatory.** Verified: return a result
without it and the SDK answers `isError: true — "Tool n has an output schema but no structured
content was provided"`. A shape mismatch is caught the same way. Since every tool declares an
`outputSchema` (plan rule 6), every success goes through `structured()`:

```ts
return structured("wrote position 214 · 180 words", { storyId, position: 214, kind: "narration", words: 180 })
```

`content` is the one-line summary; `structuredContent` is the answer. Do not put the payload in
both, and **never echo prose back** — a write returns its delta, not the passage.

The output schema's root must be an object. A non-object root gets wrapped as `{result: …}` on
the wire (SEP-2106), which nothing downstream expects.

---

## 4. Errors

⚠️ Not what you'd guess: **`registerTool` catches every throw** and turns it into
`{ isError: true, content: [{ type: "text", text: error.message }] }`. Even a `ProtocolError`.
Verified against the live handler. So a raw driver error is not a failure the client hides — it
is read aloud to the model, message and all.

Therefore:

- **Wrap every handler body in `runTool(name, …)`.** It passes `ToolInputError` through as
  advice and answers anything else with a line that leaks nothing, after logging the real error.
  There is deliberately no class for "a defect the model cannot fix": every other throw already
  lands there.
- Things the model can fix — unknown id, empty range, a name matching no lore entry — are
  `throw new ToolInputError("No story with id abc123.")` or a direct `return failed("…")`. Say
  what to do next: *"No lore entry named 'Vell'. Call story_map for the index."*
- Never attach `structuredContent` to an `isError` result. Output-schema validation correctly
  skips error results; adding structured content to one just re-opens the validation you dodged.

---

## 5. Multi-round-trip (`delete_story` only)

The 2026-07-28 flow replaces the old push-style `ctx.mcpReq.elicitInput`, which now throws on a
modern request. A handler that needs an answer **returns** `inputRequired(...)`, the client
gathers it, and the same handler is called again with the answer attached.

Verified end to end:

```ts
import { acceptedContent, inputRequired } from "@modelcontextprotocol/server"

const confirmSchema = z.object({ confirm: z.boolean() })

async (args, ctx) =>
  runTool("delete_story", async () => {
    const state = ctx.mcpReq.requestState<RequestStatePayload>()
    const answer = acceptedContent(ctx.mcpReq.inputResponses, "confirm", confirmSchema)

    // Round 1: nothing sealed yet, or the seal was minted for a different tool.
    if (!state || state.tool !== "delete_story" || !answer) {
      return inputRequired({
        inputRequests: {
          confirm: inputRequired.elicit({
            message: `Delete "${title}" and everything in it? This cannot be undone.`,
            requestedSchema: confirmSchema,
          }),
        },
        requestState: await deps.mintRequestState({ tool: "delete_story", storyId: args.storyId }, ctx),
      })
    }

    // Round 2: verified state + the writer's answer.
    if (!answer.confirm) return structured("Cancelled.", { id: state.storyId, deleted: false })
    …
  })
```

Mechanics worth knowing:

- `ctx.mcpReq.requestState<T>()` returns the **decoded, verified payload**, not the wire string
  — `server.ts` wires `codec.verify` into `ServerOptions.requestState.verify`, and the SDK runs
  it before your handler is entered. A tampered or expired seal never reaches you; the client
  gets a frozen `-32602`.
- The seal is **signed, not encrypted**. The client can base64-decode and read the payload. Put
  identifiers and intent in it, never secrets.
- The codec's `bind` is `ctx.mcpReq.method`, which is `"tools/call"` for every tool and so
  cannot tell them apart. **Check `state.tool` yourself** — that check is the only thing stopping
  a seal minted by one tool from being replayed into another.
- `acceptedContent(responses, key, schema)` returns the content only when the writer *accepted*.
  Decline and cancel both read as `undefined`; use `inputResponse(responses, key)` if you need
  to tell the two apart.
- `ttlSeconds` is 300. A confirmation left unanswered for six minutes has to be asked again.

Do not use this for anything else. Every other write acts on its first call.

---

## 6. Reaching the app

Tools are not a second implementation of the app — they call what the UI calls, so the undo
journal and the sync bus behave identically.

- **Reads**: `lib/db/queries.ts` — `listStories`, `listStoriesWithCounts`, `getStory`,
  `getStoryFull`, `listOlderEntries`, `resolveStoryRecap`, `listLorebookEntries`,
  `getLorebookEntry`, `getAppSettings`. Add new queries there rather than opening Drizzle in a
  tool file. This server added a section of its own to that file:
  `getManuscriptBounds`, `readManuscriptWindow`, `getLivePassageAtPosition`,
  `countLivePassages`, `countLivePassagesAfter`, `countLivePassagesByStory`,
  `searchStoryEntries`, `searchLorebookContent`, `escapeLikeNeedle`, `getUsageAggregate`.
  The position reads are shared on purpose — `read`/`story_map` want the same bounds and
  `edit`/`rewind` the same lookup, and two private copies of "live means the active take and
  not soft-deleted" is how the tools would drift apart.
- **Writes**: the server actions in `lib/actions/*` — `createStory`, `updateStoryMeta`,
  `deleteStory`, `appendActionEntry`, `updateEntryText`, `rewindToEntry`, `createLorebookEntry`,
  `updateLorebookEntry`, `loadEntryContext`. They carry `"use server"`, which is fine to import
  and await from a route handler; a direct call is a direct call.
- **Never bypass the ops journal.** Every mutation goes through the path that writes `story_ops`
  and calls `commitChange` / `touchStory`, or an AI write becomes the one thing the writer cannot
  undo and open browsers show stale text.
- The route is `runtime = "nodejs"` because both of those depend on it: the pg pool and the
  in-process bus (a `Set` on `globalThis`) do not exist in an edge isolate.

---

## 7. House rules from the plan

These are the reason the server is worth building; a tool that breaks them costs the writer
tokens on every call.

1. **Workflow-shaped, not CRUD.** Fourteen tools cover the whole surface. If you find yourself
   wanting a fifteenth, the answer is usually a flag on an existing one.
2. **Compact by default.** Lists return ids and counts. Reads default to the tail (~10 entries).
   Searches return snippets (`snippet()`, ~160 chars), never passages. Detail is opt-in.
3. **Map before manuscript.** `story_map` is the cheap orientation; other tools may assume the
   model has one and need not restate genre, memory or lore.
4. **Positions are the handle.** `story_entries.position` and `story_images.position` share one
   per-story counter. Every result cites the positions it covers; every read accepts a range of
   them (`resolveRange` in `helpers.ts`, including the `"start"` / `"end"` anchors).
5. **Writes return deltas.** "wrote position 214", "retired 6 passages" — plus the
   `structuredContent`. Never the text back.
6. **Every tool declares `outputSchema` and returns `structuredContent`.** §3.
7. **Registration order is fixed** and lives in `server.ts`. Reads, then writes, then destroy.

Descriptions are the most-read text in the server: the client model sees all fourteen on every
`tools/list`. Aim for one or two sentences — what it does, what it returns, when to reach for it
over its neighbour. `read`'s description earns its length by naming its default (the tail) so the
model does not send a range it did not need.

### Cache hints ⚠️

Only list-shaped results are cacheable on this revision: `tools/list`, `prompts/list`,
`resources/list`, `resources/templates/list`, `resources/read`, `server/discover`. **A
`tools/call` result is never cacheable**, so the plan's "`ttlMs` cache hints on list results"
cannot mean `list_stories`. `server.ts` sets the one hint that exists —
`cacheHints: { "tools/list": { ttlMs: 300000, cacheScope: "private" } }` — and a read tool that
wants to be re-asked cheaply has to be cheap.

---

## 8. Helpers reference

From `@/lib/mcp/helpers`:

| Helper | Use |
|---|---|
| `structured(summary, data)` | The only success return. |
| `failed(reason)` | Model-visible failure; no structured content. |
| `runTool(name, body)` | Wrap every handler body. §4. |
| `ToolInputError` | Throw inside `runTool` for advice the model can act on. |
| `resolveRange(input, bounds, defaultLimit)` | `from`/`to`/`limit` → inclusive window. Defaults to the tail; resolves `"start"` / `"end"`. |
| `paginate(rows, cursor, limit)` | `{ items, nextCursor, total }` over an ordered array. |
| `encodeCursor` / `decodeCursor` | When you page in SQL instead. |
| `clampLimit(n)` | Keeps a client `limit` in `1..100`. |
| `snippet(text, max?)` | Whitespace-collapsed, word-boundary truncation with an ellipsis. |
| `matchSnippet(text, needle, radius?)` | A snippet windowed on WHERE the text matched. For search hits. |
| `wordCount`, `plural`, `line`, `shortDate`, `usd` | Summary-line formatting. |
| `MAX_PAGE_SIZE`, `SNIPPET_CHARS`, `MATCH_RADIUS` | The shared ceilings. Use them in `z.number().max(…)`. |

Shared types: `RegisterTool`, `ToolDeps`, `RequestStatePayload`, `PositionArg`, `Page<T>`.

---

## 9. Testing

Colocate as `lib/mcp/**/*.test.ts`, run with `bun test`. Prefer testing the handler's logic
against mocked queries; a DB is not needed to prove a range resolved or a summary read right.

### ⚠️ `mock.module` is process-wide

It replaces a specifier for the whole test RUN, not for the file that called it. Nine specs in
`tools/` need a different slice of `lib/db/queries.ts`, and when each registered its own partial
object the last one won — a spec that had already bound `getUsageAggregate` found it gone, and
bun blamed the real file: `SyntaxError: Export named 'getUsageAggregate' not found`.

So there is one double, `lib/mcp/tools/test-queries.ts`. Its registered shape is fixed and
complete; behavior sits in a table behind it. A spec calls `installQueryMocks()` at module scope
and `stubQueries({ … })` from `beforeEach` — from `beforeEach` because bun collects every spec's
top level before running a test, so a module-scope choice would be overwritten by the next file
collected. **Add a name to that module's `DEFAULTS` when a tool starts importing a new read.**

`test-mocks.ts` does the same for the write tools' `lib/actions/*` doubles.

### The integration spec

`lib/mcp/server.test.ts` builds the real factory and asks it `tools/list`: all fourteen names in
the fixed order, an object `outputSchema` and `inputSchema` on each, and the annotations reads
and destructive tools are supposed to carry. It never CALLS a tool — its doubles exist only
because importing the server reaches `lib/actions/*`, which import `"server-only"` and throw
outside a React Server Component.

To drive the handler directly — no server, no network — see that spec, or:

```ts
import { createMcpHandler } from "@modelcontextprotocol/server"
import { createMcpServer } from "@/lib/mcp/server"

const handler = createMcpHandler(createMcpServer)
const res = await handler.fetch(
  new Request("http://localhost/api/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "read", arguments: { storyId } } }),
  }),
)
```

That claim-less POST is served by the **legacy stateless fallback** — the era a 2025 client gets,
and the easiest one to hand-write. A modern (2026-07-28) request additionally needs the
`_meta` envelope in `params` (`io.modelcontextprotocol/protocolVersion`, `…/clientInfo`,
`…/clientCapabilities`) and the SEP-2243 headers `Mcp-Protocol-Version`, `Mcp-Method` and, for a
call, `Mcp-Name` — the entry rejects a header/body mismatch with `-32020` before your handler
runs. Both eras come off the same factory, so testing either exercises your tool.

⚠️ Database: never point a test at devpg (port 5432), and never run seed or reset against it.
Use this worktree's own compose Postgres on its own port.
