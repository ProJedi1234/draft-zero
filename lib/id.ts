// lib/id.ts — Random ids that survive an insecure context.

/**
 * A v4 UUID that works in the browser too.
 *
 * `crypto.randomUUID()` is secure-context only: it exists on HTTPS and on
 * localhost, and is undefined over plain HTTP to an IP — which is how the app
 * is reached from another machine on the LAN. Invisible in local development,
 * and total the moment the URL stops saying localhost.
 *
 * Server code doesn't need this (Node's global always has it), so the call
 * sites in lib/actions/* are left alone. The fallback is a real v4 UUID because
 * getRandomValues has no such restriction — no reason to weaken the id.
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
