// lib/id.ts — Random ids that survive an insecure context.

/**
 * A v4 UUID, in the browser as well as on the server.
 *
 * `crypto.randomUUID()` is **secure-context only**. It exists on HTTPS and on
 * localhost, and is `undefined` over plain HTTP to an IP address — which is
 * exactly how this app is reached when somebody tries it from another machine
 * on the LAN, because compose publishes the dev server on every interface. The
 * failure is invisible in ordinary local development and total the moment the
 * URL stops saying localhost: the composer throws "crypto.randomUUID is not a
 * function" the first time a writer presses Send or Continue.
 *
 * Server code never needed this — Node's global always carries randomUUID — so
 * the call sites in lib/actions/* are correct as they stand and are left alone.
 * This exists for the one id the client mints, the per-turn id in
 * hooks/use-generation.ts.
 *
 * The fallback is a real v4 UUID rather than a Math.random string, because
 * `crypto.getRandomValues` carries no secure-context restriction and there is
 * no reason to weaken the id just because the page was served over HTTP.
 */
export function randomId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID()
  }

  const bytes = crypto.getRandomValues(new Uint8Array(16))
  // The two fields a v4 UUID pins: version 4 in the high nibble of byte 6, and
  // the 10xx variant in the top bits of byte 8. Everything else stays random.
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80

  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-")
}
