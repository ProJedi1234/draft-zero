// lib/mcp/server.ts — one fresh McpServer per HTTP request, with every tool
// registered in a fixed order.
//
// Per-request is not a choice: `createMcpHandler` serves the stateless
// 2026-07-28 revision, so there is no instance to keep between calls. The cost
// that buys is paid on every request, which is why registration is nothing but
// a loop over declarations — a registrar that opens a DB connection or reads
// settings at registration time makes every `tools/list` pay for it.
import {
  McpServer,
  createRequestStateCodec,
  type McpServerFactory,
  type ServerContext,
} from "@modelcontextprotocol/server"

import { EXPIRED_REQUEST_STATE } from "@/lib/mcp/helpers"
import type {
  RegisterTool,
  RequestStatePayload,
  ToolDeps,
} from "@/lib/mcp/helpers"
import { registerContextBreakdown } from "@/lib/mcp/tools/context-breakdown"
import { registerEdit } from "@/lib/mcp/tools/edit"
import { registerListStories } from "@/lib/mcp/tools/list-stories"
import { registerLoreGet, registerLoreWrite } from "@/lib/mcp/tools/lore"
import { registerRead } from "@/lib/mcp/tools/read"
import { registerRewind } from "@/lib/mcp/tools/rewind"
import { registerSearch } from "@/lib/mcp/tools/search"
import {
  registerCreateStory,
  registerDeleteStory,
  registerUpdateStory,
} from "@/lib/mcp/tools/story-crud"
import { registerStoryMap } from "@/lib/mcp/tools/story-map"
import { registerUsage } from "@/lib/mcp/tools/usage"
import { registerWrite } from "@/lib/mcp/tools/write"

const SERVER_INFO = {
  name: "draft-zero",
  title: "Draft 0",
  version: "1.0.0",
} as const

/**
 * Read first. This is the only text the client model sees before it picks a
 * tool, so it teaches the two habits that keep a session cheap: orient with
 * `story_map`, and treat positions as the handles everything else takes.
 */
const INSTRUCTIONS = `Draft 0 is a single-user interactive-fiction workspace: stories made of numbered passages, plus a lorebook, a rolling recap, and a spend ledger.

Start with story_map — it fits a whole story's shape in a few hundred tokens. Then read ranges by position.

Positions are the shared handle. Passages and images draw from one per-story counter, every result cites the positions it covers, and every read and write takes them. Reads default to the tail of the manuscript; ask for a range only when you need older material.

Results are compact on purpose: lists give ids and counts, searches give snippets. Fetch the full text of a passage only when you are about to use it.`

/**
 * Tool registration order, which is the order `tools/list` reports and the
 * order the client model reads. Reads first (they are the cheap moves), then
 * writes, then the one destructive tool. Insert a new tool at its place in
 * this list rather than appending — the ordering is the curriculum.
 */
const REGISTRARS: readonly RegisterTool[] = [
  // Reads
  registerListStories,
  registerStoryMap,
  registerRead,
  registerSearch,
  registerLoreGet,
  registerUsage,
  registerContextBreakdown,
  // Writes
  registerCreateStory,
  registerWrite,
  registerEdit,
  registerRewind,
  registerLoreWrite,
  registerUpdateStory,
  // Destroy
  registerDeleteStory,
]

/**
 * The `tools/list` answer is a build-time constant — the same 14 declarations
 * every request — so it is worth caching client-side. `private` because a
 * single-user LAN app has no shared cache to populate.
 *
 * Note the limit: on this revision only list-shaped results carry cache
 * fields. A `tools/call` result is never cacheable, so a read tool that wants
 * to be re-asked cheaply has to be cheap.
 */
const TOOLS_LIST_TTL_MS = 5 * 60 * 1000

/**
 * HMAC key for the multi-round-trip `requestState`. One process serves every
 * round here, so a per-process random key is correct and leaves nothing to
 * configure; set MCP_REQUEST_STATE_KEY (32+ bytes) if this ever runs behind
 * more than one process, or a confirmation minted by one worker will be
 * refused by the next.
 */
const requestStateKey =
  process.env.MCP_REQUEST_STATE_KEY ??
  Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex")

/**
 * Module scope, deliberately: the codec must outlive the per-request server
 * instances, since it seals state on one request and verifies it on the next.
 */
const requestStateCodec = createRequestStateCodec<RequestStatePayload>({
  key: requestStateKey,
  // A confirmation the writer never answers should lapse, not linger. Long
  // enough that a model pausing to think between rounds does not lose the
  // seal, which is the common way this used to expire.
  ttlSeconds: 900,
  // Bound to the originating method, so state minted by one tool cannot be
  // replayed into another. There is no principal to bind to — no auth.
  bind: (ctx) => ctx.mcpReq.method,
})

const deps: ToolDeps = {
  mintRequestState: (payload, ctx) => requestStateCodec.mint(payload, ctx),
}

/**
 * The codec's verify, with expiry made recoverable.
 *
 * Any throw from here is turned by the SDK into a frozen `-32602 Invalid or
 * expired requestState` — a JSON-RPC error raised before the handler runs, so
 * `runTool` never sees it and the tool cannot say what happened. On a
 * confirmation for an irreversible delete that is the worst possible answer:
 * the model is told the call failed and has no way to learn whether the story
 * is still there.
 *
 * A lapsed seal is not an attack, though — it is a writer, or a model, that
 * took too long. So expiry alone resolves to {@link EXPIRED_REQUEST_STATE},
 * the handler runs, its seal check fails, and it simply asks again. If the
 * story was in fact already deleted, that re-ask reads it back as "No story
 * with id …", which is the unambiguous answer.
 *
 * Everything else — a bad MAC, a bind mismatch, a malformed envelope — is a
 * forged or replayed seal and keeps failing hard. Takes the inner verify as an
 * argument so that split is testable without forging a seal or waiting out a
 * TTL.
 */
export function recoverExpiredState(
  verify: (state: string, ctx: ServerContext) => Promise<RequestStatePayload>
): (state: string, ctx: ServerContext) => Promise<RequestStatePayload> {
  return async (state, ctx) => {
    try {
      return await verify(state, ctx)
    } catch (error) {
      // The codec throws fixed opaque reason codes: malformed / mac /
      // expired / bind. Only the lapse is recoverable.
      if (error instanceof Error && error.message === "expired") {
        return EXPIRED_REQUEST_STATE
      }
      throw error
    }
  }
}

const verifyRequestState = recoverExpiredState(requestStateCodec.verify)

/**
 * Builds the server for one request. Passed straight to `createMcpHandler`,
 * which calls it once per HTTP request (and once more per legacy-era request
 * it shims).
 *
 * Typed as an `McpServerFactory` even though it ignores the context — a
 * zero-argument factory is assignable, and the day a tool needs to vary by era
 * or by the originating request, the parameter is already the way in.
 */
export const createMcpServer: McpServerFactory = (): McpServer => {
  const server = new McpServer(SERVER_INFO, {
    capabilities: { tools: {} },
    instructions: INSTRUCTIONS,
    cacheHints: {
      "tools/list": { ttlMs: TOOLS_LIST_TTL_MS, cacheScope: "private" },
    },
    // Proves the sealed confirmation state was minted here before a
    // destructive tool acts on it. The decoded payload reaches the handler as
    // `ctx.mcpReq.requestState<RequestStatePayload>()`.
    requestState: { verify: verifyRequestState },
  })

  for (const register of REGISTRARS) register(server, deps)

  return server
}
