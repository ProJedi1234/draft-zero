import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  experimental: {
    // Server Actions default to a 1MB request body, which is generous for the
    // two JSON importers and far too small for the third: an AI Dungeon backup
    // is a zip of a whole adventure, and the action takes the archive itself
    // rather than its inflated JSON precisely so the compressed bytes are what
    // has to fit. 20mb is the reader's own MAX_BACKUP_BYTES plus headroom for
    // the multipart framing around it, so an archive the reader would accept
    // can never be rejected by the transport first — a rejection that arrives
    // as a thrown action with no message anyone can act on.
    serverActions: { bodySizeLimit: "20mb" },
  },
  // Dev-only: Next blocks requests to /_next/* dev resources unless the
  // browser's origin is localhost. Allow this box's LAN addresses so the
  // dev server is usable from phones/other machines on olympus.lan.
  //
  // "127.0.0.1" is listed even though localhost is allowed by default: they are
  // the same host but not the same origin string, and the compose stack
  // publishes the app on 0.0.0.0, so whichever of the two you type is the one
  // Next compares against. Without it, HMR silently stops reconnecting.
  allowedDevOrigins: ["127.0.0.1", "192.168.0.*", "*.olympus.lan"],
  devIndicators: {
    // Away from bottom-left, which is where the composer keeps the two
    // controls a writer touches most. The badge is draggable, and its drag
    // handler releases pointer capture without checking it still holds any —
    // an unguarded releasePointerCapture that throws NotFoundError into the
    // error overlay when a drag ends on an element that has since moved.
    // Ours is the app that put buttons under it, so ours is the config that
    // moves it.
    position: "top-right",
  },
}

export default nextConfig
