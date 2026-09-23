// tests/image-blob-store.test.ts — Where illustration bytes go, and how the
// S3 backend reports trouble.
//
// Two promises matter most. A half-set S3 config must throw rather than fall
// back to disk, because the disk it would fall back to is a container layer
// that the next recreate wipes. And a read must tell "missing" (null, a 404)
// apart from "unreachable" (a throw, a 500), or an outage renders as a gallery
// of deleted pictures.

import { afterEach, describe, expect, test } from "bun:test"

import { imageFilePath, imageObjectKey } from "@/lib/images/blob-path"
import {
  ImageStorageConfigError,
  readBlob,
  resolveImageBackend,
  S3_ENV,
  s3ObjectUrl,
  writeBlob,
  type ImageBackend,
} from "@/lib/images/blob-store"

const FULL_ENV = {
  [S3_ENV.endpoint]: "https://s3.example.com/",
  [S3_ENV.bucket]: "draft-zero-images",
  [S3_ENV.region]: "garage",
  [S3_ENV.accessKeyId]: "GKtest",
  [S3_ENV.secretAccessKey]: "not-a-real-secret",
}

const ID = "0b8f6c1e-3d2a-4f5b-9c7d-1e2f3a4b5c6d"

describe("resolveImageBackend", () => {
  test("no S3 variables means disk", () => {
    expect(resolveImageBackend({})).toEqual({ kind: "disk" })
  })

  test("blank S3 variables also mean disk", () => {
    const blank = Object.fromEntries(Object.values(S3_ENV).map((k) => [k, ""]))
    expect(resolveImageBackend(blank)).toEqual({ kind: "disk" })
  })

  test("all five means S3, with the endpoint's trailing slash dropped", () => {
    expect(resolveImageBackend(FULL_ENV)).toEqual({
      kind: "s3",
      endpoint: "https://s3.example.com",
      bucket: "draft-zero-images",
      region: "garage",
      accessKeyId: "GKtest",
      secretAccessKey: "not-a-real-secret",
    })
  })

  test("a partial set throws, naming what is missing and no values", () => {
    const partial = { ...FULL_ENV, [S3_ENV.secretAccessKey]: undefined }
    let caught: unknown
    try {
      resolveImageBackend(partial)
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(ImageStorageConfigError)
    const message = (caught as Error).message
    expect(message).toContain(S3_ENV.secretAccessKey)
    expect(message).not.toContain(S3_ENV.endpoint)
    expect(message).not.toContain("GKtest")
  })
})

describe("object key layout", () => {
  test("the key is the disk file name, at the bucket root", () => {
    expect(imageObjectKey(ID, "image/png")).toBe(`${ID}.png`)
    expect(imageObjectKey(ID, "image/svg+xml")).toBe(`${ID}.svg`)
    expect(imageObjectKey(ID, "image/jpeg")).toBe(`${ID}.jpg`)
    expect(imageObjectKey(ID, "image/webp")).toBe(`${ID}.webp`)
    expect(imageObjectKey(ID, "application/x-unknown")).toBe(`${ID}.bin`)
    expect(imageFilePath(ID, "image/png").endsWith(`/${ID}.png`)).toBe(true)
  })

  test("URLs are path-style under the endpoint", () => {
    const backend = resolveImageBackend(FULL_ENV)
    if (backend.kind !== "s3") throw new Error("expected s3")
    expect(s3ObjectUrl(backend, `${ID}.png`)).toBe(
      `https://s3.example.com/draft-zero-images/${ID}.png`
    )
  })
})

describe("S3 read and write", () => {
  const realFetch = globalThis.fetch
  const backend: ImageBackend = resolveImageBackend(FULL_ENV)
  let requests: Request[] = []

  function stubFetch(respond: (req: Request) => Response) {
    requests = []
    globalThis.fetch = (async (input: Request) => {
      requests.push(input)
      return respond(input)
    }) as typeof fetch
  }

  afterEach(() => {
    globalThis.fetch = realFetch
  })

  test("write PUTs the bytes, signed, with the row's media type", async () => {
    stubFetch(() => new Response(null, { status: 200 }))
    await writeBlob(backend, ID, "image/png", new Uint8Array([1, 2, 3]))

    expect(requests).toHaveLength(1)
    const [req] = requests
    expect(req.method).toBe("PUT")
    expect(req.url).toBe(`https://s3.example.com/draft-zero-images/${ID}.png`)
    expect(req.headers.get("Content-Type")).toBe("image/png")
    const auth = req.headers.get("Authorization") ?? ""
    expect(auth).toStartWith("AWS4-HMAC-SHA256 Credential=GKtest/")
    expect(auth).toContain("/garage/s3/aws4_request")
    expect(new Uint8Array(await req.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3])
    )
  })

  test("a failed write throws", async () => {
    stubFetch(() => new Response(null, { status: 403 }))
    await expect(
      writeBlob(backend, ID, "image/png", new Uint8Array([1]))
    ).rejects.toThrow("403")
  })

  test("read returns the object's bytes", async () => {
    stubFetch(() => new Response(new Uint8Array([9, 8, 7]), { status: 200 }))
    const bytes = await readBlob(backend, ID, "image/webp")

    expect(requests[0].method).toBe("GET")
    expect(requests[0].url).toBe(
      `https://s3.example.com/draft-zero-images/${ID}.webp`
    )
    expect(bytes).toEqual(Buffer.from([9, 8, 7]))
  })

  test("a missing object reads as null", async () => {
    stubFetch(
      () =>
        new Response("<Error><Code>NoSuchKey</Code></Error>", { status: 404 })
    )
    expect(await readBlob(backend, ID, "image/png")).toBeNull()
  })

  test("a server error throws instead of reading as missing", async () => {
    stubFetch(() => new Response(null, { status: 500 }))
    await expect(readBlob(backend, ID, "image/png")).rejects.toThrow("500")
    // One attempt plus the two bounded retries, not aws4fetch's default ten.
    expect(requests).toHaveLength(3)
  })
})
