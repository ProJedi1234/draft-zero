// GET /api/health — is this server answering?
//
// The probe behind the connection state machine and the "draft zero server"
// row in the connection test. Deliberately does NOT touch the database: a
// server that is up with a broken Postgres is a different fault from a server
// that cannot be reached, and collapsing the two would cost the one piece of
// information this endpoint exists to provide.
//
// Cheap enough to poll. The client's cadence is in lib/net/connection.ts.

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(): Promise<Response> {
  return new Response(JSON.stringify({ ok: true, serverTime: Date.now() }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      // Without this a proxy or the browser's HTTP cache can answer the probe
      // from a copy taken while the network still worked, which would make the
      // app announce it is back online while it is not.
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  })
}
