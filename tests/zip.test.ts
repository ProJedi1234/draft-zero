// tests/zip.test.ts — What lib/import/zip.ts is allowed to read, and what it
// must refuse.
//
// This is a hand-rolled reader for a binary format, which makes its failure
// modes the quiet kind: every field is an offset into a byte range, and an
// offset that is wrong by two bytes does not throw — it returns a shorter
// string, an empty entry, or someone else's data. So the assertions here are on
// exact bytes out, and half the file is refusals.
//
// The refusals matter more than they look. An encrypted entry inflates to
// garbage rather than failing, and a ZIP64 sentinel read as a literal count
// walks straight off the buffer — both are cases where "refuse by name" is the
// only honest answer, and both are cases a reader silently gets wrong until
// someone hands it a real archive.

import { describe, expect, test } from "bun:test"

import { openZip, ZipError } from "@/lib/import/zip"

import { assemble, buildZip, buildZipDeflated } from "./helpers/zip"

/** One stored entry, spelled out for the `assemble` cases. */
function entry(name: string, contents: string) {
  const bytes = new TextEncoder().encode(contents)
  return { name, raw: bytes, data: bytes, method: 0 }
}

describe("reading", () => {
  test("lists entries in central-directory order", () => {
    const zip = openZip(buildZip({ "b.txt": "two", "a.txt": "one" }))

    expect(zip.names).toEqual(["b.txt", "a.txt"])
  })

  test("reads a stored entry", async () => {
    const zip = openZip(buildZip({ "a.txt": "hello" }))

    expect(await zip.readText("a.txt")).toBe("hello")
  })

  test("inflates a deflated entry", async () => {
    // Long enough that deflate actually compresses it, so this would fail if
    // the reader were quietly treating the bytes as stored.
    const text = "the same sentence over and over. ".repeat(50)
    const zip = openZip(await buildZipDeflated({ "a.txt": text }))

    expect(await zip.readText("a.txt")).toBe(text)
  })

  test("reads every entry of a multi-file archive", async () => {
    const zip = openZip(buildZip({ "a.txt": "one", "nested/b.txt": "two" }))

    expect(await zip.readText("a.txt")).toBe("one")
    expect(await zip.readText("nested/b.txt")).toBe("two")
  })

  test("decodes names and contents as UTF-8", async () => {
    const zip = openZip(buildZip({ "café.txt": "naïve — text" }))

    expect(zip.names).toEqual(["café.txt"])
    expect(await zip.readText("café.txt")).toBe("naïve — text")
  })

  test("finds the directory past a comment that quotes its signature", async () => {
    // The archive comment is arbitrary bytes AFTER the end-of-directory record,
    // and it is allowed to contain that record's own signature. Scanning
    // backwards takes the LAST match, which is the real one; scanning forwards
    // would stop inside the comment and read a directory that isn't there.
    const zip = openZip(
      assemble([entry("a.txt", "hello")], { comment: "PK not the real one" })
    )

    expect(await zip.readText("a.txt")).toBe("hello")
  })
})

describe("refusals", () => {
  test("bytes with no end-of-directory record", () => {
    expect(() => openZip(new Uint8Array(64))).toThrow(ZipError)
  })

  test("an entry that isn't in the archive", () => {
    const zip = openZip(buildZip({ "a.txt": "hello" }))

    expect(zip.read("b.txt")).rejects.toThrow(ZipError)
  })

  test("an encrypted archive", () => {
    // Refused rather than read: an encrypted entry inflates to garbage instead
    // of failing, so reading it would hand the caller plausible nonsense.
    expect(() =>
      openZip(assemble([entry("a.txt", "hello")], { encrypted: true }))
    ).toThrow(/encrypted/)
  })

  test("a ZIP64 archive", () => {
    // The sentinel means the real count lives in a record this reader does not
    // parse. Taken literally it is 65535 entries, and the directory walk runs
    // off the end of the buffer looking for them.
    expect(() =>
      openZip(assemble([entry("a.txt", "hello")], { zip64: true }))
    ).toThrow(/ZIP64/)
  })

  test("a corrupt directory", () => {
    const bytes = buildZip({ "a.txt": "hello" })
    // Blank the central directory's signature, leaving the EOCD pointing at
    // something that is no longer a directory header.
    const view = new DataView(bytes.buffer)
    const directoryOffset = view.getUint32(bytes.length - 22 + 16, true)
    view.setUint32(directoryOffset, 0, true)

    expect(() => openZip(bytes)).toThrow(ZipError)
  })
})

describe("the inflate budget", () => {
  /** Deflates to a fraction of its size, which is the whole point. */
  const COMPRESSIBLE = "0".repeat(512 * 1024)

  test("a legitimate archive inside the budget reads whole", async () => {
    const zip = openZip(await buildZipDeflated({ "a.txt": COMPRESSIBLE }), {
      maxInflatedBytes: 1024 * 1024,
    })

    expect((await zip.readText("a.txt")).length).toBe(COMPRESSIBLE.length)
  })

  test("refuses an entry the directory admits is too big", async () => {
    // The cheap path: the declared size is right there in the directory, so an
    // honest oversized archive costs nothing to reject — no decompressor is
    // ever started.
    const zip = openZip(await buildZipDeflated({ "a.txt": COMPRESSIBLE }), {
      maxInflatedBytes: 1024,
    })

    expect(zip.read("a.txt")).rejects.toThrow(/expands to more/)
  })

  test("refuses a bomb that LIES about its declared size", async () => {
    // The path that actually matters. The pre-check reads a field the archive's
    // author writes, so a bomb simply understates it — and then only counting
    // the bytes as they arrive can stop it.
    const bytes = await buildZipDeflated({ "a.txt": COMPRESSIBLE })
    const view = new DataView(bytes.buffer)
    const directoryOffset = view.getUint32(bytes.length - 22 + 16, true)
    view.setUint32(directoryOffset + 24, 16, true) // "it's 16 bytes, honest"

    const zip = openZip(bytes, { maxInflatedBytes: 1024 })

    expect(zip.read("a.txt")).rejects.toThrow(/decompression bomb/)
  })

  test("the budget is shared across the whole archive", async () => {
    // A per-entry cap of N with a hundred entries is a cap of 100N, which is no
    // cap at all. Each of these fits; together they must not.
    const half = "0".repeat(400 * 1024)
    const zip = openZip(
      await buildZipDeflated({ "a.txt": half, "b.txt": half }),
      { maxInflatedBytes: 600 * 1024 }
    )

    expect((await zip.read("a.txt")).length).toBe(half.length)
    expect(zip.read("b.txt")).rejects.toThrow(ZipError)
  })

  test("stored entries spend it too", () => {
    // Not a bomb — the bytes are already in the archive — but still output, and
    // a budget that ignored them would hand a caller more than it agreed to.
    const zip = openZip(buildZip({ "a.txt": "hello" }), { maxInflatedBytes: 2 })

    expect(zip.read("a.txt")).rejects.toThrow(ZipError)
  })
})
