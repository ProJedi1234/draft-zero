// lib/images/blob-path.ts — Where an illustration's bytes sit on disk.
//
// Split out of store.ts, which is `server-only`, so that scripts outside the
// Next runtime — the seed, above all — can write a blob the app will later
// read. Path arithmetic and nothing else: no I/O here, so there is nothing for
// the server-only guard to protect.

import path from "node:path"

/**
 * The blob root. Relative by default so the dev stack's bind mount carries it
 * back to the host — an illustration must survive `docker compose down`, and an
 * anonymous volume would quietly not.
 */
const DATA_DIR = process.env.DRAFT_ZERO_DATA_DIR ?? ".data"

export const IMAGE_DIR = path.join(DATA_DIR, "images")

/** Extensions we are willing to write, keyed by the media type that produced them. */
const EXTENSIONS: Record<string, string> = {
  "image/svg+xml": "svg",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
}

function extensionFor(mediaType: string): string {
  return EXTENSIONS[mediaType] ?? "bin"
}

export function imageFilePath(id: string, mediaType: string): string {
  // The id is a UUID minted server-side, never user input, so it cannot walk
  // out of the directory — but basename it anyway rather than rely on that
  // staying true of every future caller.
  return path.join(IMAGE_DIR, `${path.basename(id)}.${extensionFor(mediaType)}`)
}
