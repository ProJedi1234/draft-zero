// lib/images/blob-store.ts — The two places illustration bytes can live.
//
// Disk by default, an S3 bucket when all five DRAFT_ZERO_IMAGES_S3_* variables
// are set. Not `server-only`, for the same reason as blob-path.ts: the seed
// writes blobs outside the Next runtime and must land them wherever the app
// will later read them. lib/images/store.ts is the guarded entry the app uses.
//
// A partial S3 config is an error, never a quiet fall back to disk. Falling
// back would write pictures into a container layer that the next recreate
// deletes, and nobody would notice until they were gone.

import { mkdir, readFile, writeFile } from "node:fs/promises"

import { AwsClient } from "aws4fetch"

import { IMAGE_DIR, imageFilePath, imageObjectKey } from "./blob-path"

export const S3_ENV = {
  endpoint: "DRAFT_ZERO_IMAGES_S3_ENDPOINT",
  bucket: "DRAFT_ZERO_IMAGES_S3_BUCKET",
  region: "DRAFT_ZERO_IMAGES_S3_REGION",
  accessKeyId: "DRAFT_ZERO_IMAGES_S3_ACCESS_KEY_ID",
  secretAccessKey: "DRAFT_ZERO_IMAGES_S3_SECRET_ACCESS_KEY",
} as const

type S3Field = keyof typeof S3_ENV

export type S3Config = { [K in S3Field]: string }

export type ImageBackend = { kind: "disk" } | ({ kind: "s3" } & S3Config)

export class ImageStorageConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ImageStorageConfigError"
  }
}

/**
 * Picks the backend from the environment.
 *
 * @throws ImageStorageConfigError when some but not all of the S3 variables
 *   are set. The message names the missing variables, never any values.
 */
export function resolveImageBackend(
  env: Record<string, string | undefined> = process.env
): ImageBackend {
  const fields = Object.keys(S3_ENV) as S3Field[]
  // An empty string counts as unset, so a blank line copied from .env.example
  // does not half-enable the bucket.
  const present = fields.filter((f) => env[S3_ENV[f]]?.trim())

  if (present.length === 0) return { kind: "disk" }
  if (present.length < fields.length) {
    const missing = fields.filter((f) => !present.includes(f))
    throw new ImageStorageConfigError(
      `Image storage is half-configured for S3: ${missing
        .map((f) => S3_ENV[f])
        .join(", ")} ${missing.length === 1 ? "is" : "are"} unset. ` +
        "Set all five DRAFT_ZERO_IMAGES_S3_* variables, or none to use disk."
    )
  }

  const config = Object.fromEntries(
    fields.map((f) => [f, env[S3_ENV[f]]!.trim()])
  ) as S3Config
  return {
    kind: "s3",
    ...config,
    endpoint: config.endpoint.replace(/\/+$/, ""),
  }
}

/** Path-style URL, the only addressing Garage serves under one hostname. */
export function s3ObjectUrl(config: S3Config, key: string): string {
  return `${config.endpoint}/${encodeURIComponent(config.bucket)}/${encodeURIComponent(key)}`
}

function s3Client(config: S3Config): AwsClient {
  return new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    // Explicit: aws4fetch guesses both from an amazonaws.com hostname, and a
    // self-hosted endpoint gives it nothing to guess from.
    service: "s3",
    region: config.region,
    // aws4fetch defaults to 10 retries with exponential backoff, which would
    // hold an image request open for most of a minute during an outage.
    retries: 2,
  })
}

export async function writeBlob(
  backend: ImageBackend,
  id: string,
  mediaType: string,
  bytes: Uint8Array
): Promise<void> {
  if (backend.kind === "disk") {
    await mkdir(IMAGE_DIR, { recursive: true })
    await writeFile(imageFilePath(id, mediaType), bytes)
    return
  }

  const key = imageObjectKey(id, mediaType)
  const res = await s3Client(backend).fetch(s3ObjectUrl(backend, key), {
    method: "PUT",
    headers: { "Content-Type": mediaType },
    // Copied into a plain ArrayBuffer view, which is what BodyInit accepts.
    body: new Uint8Array(bytes),
  })
  if (!res.ok) {
    throw new Error(`S3 PUT ${key} failed: ${res.status} ${res.statusText}`)
  }
}

/**
 * An image's bytes, or null when they are gone.
 *
 * @throws Error on any S3 failure other than a missing object, so an outage
 *   surfaces as a 5xx rather than a picture that looks deleted.
 */
export async function readBlob(
  backend: ImageBackend,
  id: string,
  mediaType: string
): Promise<Buffer | null> {
  if (backend.kind === "disk") {
    try {
      return await readFile(imageFilePath(id, mediaType))
    } catch {
      return null
    }
  }

  const key = imageObjectKey(id, mediaType)
  const res = await s3Client(backend).fetch(s3ObjectUrl(backend, key))
  if (res.status === 404) return null
  if (!res.ok) {
    throw new Error(`S3 GET ${key} failed: ${res.status} ${res.statusText}`)
  }
  return Buffer.from(await res.arrayBuffer())
}
