import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  // Dev-only: Next blocks requests to /_next/* dev resources unless the
  // browser's origin is localhost. Allow this box's LAN addresses so the
  // dev server is usable from phones/other machines on olympus.lan.
  allowedDevOrigins: ["192.168.0.*", "*.olympus.lan"],
}

export default nextConfig
