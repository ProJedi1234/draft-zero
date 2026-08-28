// /api/mcp — the whole MCP endpoint, adapting one fetch-shaped SDK handler to
// Next's route exports.
//
// The handler is module-scoped and the server is not: `createMcpHandler` owns
// the transport and the subscription bus (both want to outlive a request),
// while the factory it wraps builds a fresh McpServer per request because the
// 2026-07-28 revision is stateless. Rebuilding the handler per request would
// leak a transport each time.
//
// GET and DELETE are exported so the SDK answers them — they are 2025-era
// session operations this stateless endpoint has no answer for, and the SDK's
// 405 says so in JSON-RPC. Next's own 405 would say it in HTML.
import {
  createMcpHandler,
  hostHeaderValidationResponse,
  localhostAllowedHostnames,
  localhostAllowedOrigins,
  originValidationResponse,
} from "@modelcontextprotocol/server"

import { createMcpServer } from "@/lib/mcp/server"

// Node, explicitly: the tools reach the same Postgres pool and the same
// in-process sync bus the rest of the app writes through, neither of which
// exists in an edge isolate.
export const runtime = "nodejs"

// Tools read and write live rows; a cached response would hand the model a
// story that has since moved.
export const dynamic = "force-dynamic"

const handler = createMcpHandler(createMcpServer, {
  // Trust model is the app's own: single-user, LAN, no auth. Nothing here
  // verifies a token, so nothing here should pretend to.
  onerror: (error) => {
    console.error("[mcp]", error)
  },
})

/**
 * Hostnames this endpoint answers to. Localhost by default; `MCP_ALLOWED_HOSTS`
 * adds the LAN names it is actually reached on, since compose binds it on
 * 0.0.0.0.
 */
function extraHosts(): string[] {
  return (process.env.MCP_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean)
}

// `createMcpHandler` is deliberately validation-free, so DNS rebinding
// protection has to sit here or nowhere. "No auth" is a statement about
// tokens; it does not license a web page the writer happens to visit to drive
// `delete_story` through the browser as if it were same-origin.
function serve(request: Request): Promise<Response> {
  const rejected =
    hostHeaderValidationResponse(request, [
      ...localhostAllowedHostnames(),
      ...extraHosts(),
    ]) ??
    originValidationResponse(request, [
      ...localhostAllowedOrigins(),
      ...extraHosts(),
    ])
  if (rejected) return Promise.resolve(rejected)
  return handler.fetch(request)
}

export const POST = serve
export const GET = serve
export const DELETE = serve
