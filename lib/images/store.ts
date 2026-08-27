// lib/images/store.ts — Where illustration bytes actually live. Server-only.
//
// On disk, not in Postgres: getStory loads a whole manuscript on every request,
// and a base64 column would put a megabyte per illustration into that read for
// the sake of data nothing ever queries. The row holds the identity, the file
// holds the pixels, and lib/db/schema.ts's story_images is small enough to stay
// cheap however many pictures a story accumulates.
//
// Deleting a row deliberately does NOT delete its file. Illustration delete is
// a soft delete that undo can reverse, and a file removed on the way out would
// make that undo restore a row pointing at nothing.
import "server-only"

import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

/**
 * The blob root. Relative by default so the dev stack's bind mount carries it
 * back to the host — an illustration must survive `docker compose down`, and an
 * anonymous volume would quietly not.
 */
const DATA_DIR = process.env.DRAFT_ZERO_DATA_DIR ?? ".data"

const IMAGE_DIR = path.join(DATA_DIR, "images")

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

function fileFor(id: string, mediaType: string): string {
  // The id is a UUID minted server-side, never user input, so it cannot walk
  // out of the directory — but basename it anyway rather than rely on that
  // staying true of every future caller.
  return path.join(IMAGE_DIR, `${path.basename(id)}.${extensionFor(mediaType)}`)
}

/** Writes an image's bytes. Returns nothing: the row's id + mediaType locate it. */
export async function writeImage(
  id: string,
  mediaType: string,
  b64: string
): Promise<void> {
  await mkdir(IMAGE_DIR, { recursive: true })
  await writeFile(fileFor(id, mediaType), Buffer.from(b64, "base64"))
}

/**
 * An image's bytes, or null when the file is gone.
 *
 * Null rather than a throw because a missing file is a recoverable state the
 * route turns into a 404 — a story whose blobs were cleaned up should show
 * broken pictures, not fail to load.
 */
export async function readImage(
  id: string,
  mediaType: string
): Promise<Buffer | null> {
  try {
    return await readFile(fileFor(id, mediaType))
  } catch {
    return null
  }
}
