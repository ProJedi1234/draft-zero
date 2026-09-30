import Compression
import Foundation

/// Just enough of PKZIP to read an AI Dungeon backup: stored and deflated
/// entries, no ZIP64, no encryption, no spanning. A port of lib/import/zip.ts.
///
/// Every read spends one shared inflate budget, because an archive's size says
/// nothing about its contents: DEFLATE reaches ~1000:1, so capping only the
/// input caps nothing.
nonisolated struct ZipArchive {
    private static let localHeader: UInt32 = 0x0403_4B50
    private static let centralHeader: UInt32 = 0x0201_4B50
    private static let endOfDirectory: UInt32 = 0x0605_4B50
    private static let zip64Locator: UInt32 = 0x0706_4B50

    private let bytes: [UInt8]
    let entries: [ZipEntry]
    private var budget: Int

    var names: [String] { entries.map(\.name) }

    /// Reads only the directory; entries inflate when asked for.
    init(_ data: Data, maxInflatedBytes: Int) throws(ZipArchiveError) {
        bytes = [UInt8](data)
        budget = maxInflatedBytes
        entries = try Self.readDirectory(bytes)
    }

    /// "PK\u{3}\u{4}", a zip's first local header: the only sniff that
    /// separates the archive format from the two JSON ones.
    static func isZip(_ data: Data) -> Bool {
        data.count >= 4 && data.prefix(4).elementsEqual([0x50, 0x4B, 0x03, 0x04])
    }

    mutating func readText(_ name: String) throws(ZipArchiveError) -> String {
        String(decoding: try read(name), as: UTF8.self)
    }

    mutating func read(_ name: String) throws(ZipArchiveError) -> Data {
        guard let entry = entries.first(where: { $0.name == name }) else {
            throw ZipArchiveError(message: "That zip has no \"\(name)\" in it.")
        }
        let compressed = try slice(entry)
        switch entry.method {
        case 0:
            try spend(compressed.count)
            return Data(compressed)
        case 8:
            guard entry.uncompressedSize <= budget else {
                throw ZipArchiveError(message: "\"\(entry.name)\" expands to more than this reader will hold.")
            }
            return try inflate(compressed, name: entry.name)
        default:
            throw ZipArchiveError(message: "\"\(entry.name)\" uses a compression this reader can't open.")
        }
    }

    // MARK: - Directory

    private static func readDirectory(_ bytes: [UInt8]) throws(ZipArchiveError) -> [ZipEntry] {
        guard let eocd = findEndOfDirectory(bytes) else {
            throw ZipArchiveError(message: "That file isn't a zip archive.")
        }
        guard u16(bytes, eocd + 4) == 0, u16(bytes, eocd + 6) == 0 else {
            throw ZipArchiveError(message: "That zip is split across multiple files.")
        }
        let count = u16(bytes, eocd + 10)
        let directoryOffset = u32(bytes, eocd + 16)
        if count == 0xFFFF || directoryOffset == 0xFFFF_FFFF
            || (eocd >= 20 && u32(bytes, eocd - 20) == zip64Locator) {
            throw ZipArchiveError(message: "That zip uses ZIP64, which this reader can't open.")
        }

        var entries: [ZipEntry] = []
        var offset = Int(directoryOffset)
        for _ in 0..<count {
            guard offset + 46 <= bytes.count else {
                throw ZipArchiveError(message: "That zip's directory is truncated.")
            }
            guard u32(bytes, offset) == centralHeader else {
                throw ZipArchiveError(message: "That zip's directory is corrupt.")
            }
            // An encrypted entry inflates to garbage rather than failing.
            guard u16(bytes, offset + 8) & 0x1 == 0 else {
                throw ZipArchiveError(message: "That zip is encrypted.")
            }
            let nameLength = Int(u16(bytes, offset + 28))
            let extraLength = Int(u16(bytes, offset + 30))
            let commentLength = Int(u16(bytes, offset + 32))
            guard offset + 46 + nameLength <= bytes.count else {
                throw ZipArchiveError(message: "That zip's directory is truncated.")
            }
            entries.append(ZipEntry(
                name: String(decoding: bytes[(offset + 46)..<(offset + 46 + nameLength)], as: UTF8.self),
                method: Int(u16(bytes, offset + 10)),
                compressedSize: Int(u32(bytes, offset + 20)),
                uncompressedSize: Int(u32(bytes, offset + 24)),
                localHeaderOffset: Int(u32(bytes, offset + 42))
            ))
            offset += 46 + nameLength + extraLength + commentLength
        }
        return entries
    }

    /// Scans backwards, since a comment of up to 64KB may follow the record.
    private static func findEndOfDirectory(_ bytes: [UInt8]) -> Int? {
        guard bytes.count >= 22 else { return nil }
        let floor = max(0, bytes.count - (22 + 0xFFFF))
        var offset = bytes.count - 22
        while offset >= floor {
            if u32(bytes, offset) == endOfDirectory { return offset }
            offset -= 1
        }
        return nil
    }

    /// The entry's compressed bytes. Name and extra lengths come from the local
    /// header, which may differ from the central directory's copy.
    private func slice(_ entry: ZipEntry) throws(ZipArchiveError) -> ArraySlice<UInt8> {
        let start = entry.localHeaderOffset
        guard start + 30 <= bytes.count, Self.u32(bytes, start) == Self.localHeader else {
            throw ZipArchiveError(message: "\"\(entry.name)\" isn't where the zip says it is.")
        }
        let dataStart = start + 30 + Int(Self.u16(bytes, start + 26)) + Int(Self.u16(bytes, start + 28))
        let dataEnd = dataStart + entry.compressedSize
        guard dataEnd <= bytes.count else {
            throw ZipArchiveError(message: "\"\(entry.name)\" is truncated.")
        }
        return bytes[dataStart..<dataEnd]
    }

    // MARK: - Inflate

    /// Streams the raw DEFLATE data (Compression's `.zlib` is headerless),
    /// counting output as it arrives so a bomb is abandoned early.
    private mutating func inflate(_ compressed: ArraySlice<UInt8>, name: String) throws(ZipArchiveError) -> Data {
        var output = Data()
        var remaining = budget
        do {
            let filter = try OutputFilter(.decompress, using: .zlib) { chunk in
                guard let chunk else { return }
                remaining -= chunk.count
                if remaining < 0 { throw ZipArchiveError.bomb }
                output.append(chunk)
            }
            try filter.write(Data(compressed))
            try filter.finalize()
        } catch let error as ZipArchiveError {
            throw error
        } catch {
            throw ZipArchiveError(message: "\"\(name)\" couldn't be decompressed.")
        }
        budget = remaining
        return output
    }

    private mutating func spend(_ count: Int) throws(ZipArchiveError) {
        budget -= count
        if budget < 0 { throw ZipArchiveError.bomb }
    }

    // MARK: - Little-endian fields

    private static func u16(_ bytes: [UInt8], _ offset: Int) -> UInt16 {
        guard offset >= 0, offset + 2 <= bytes.count else { return 0 }
        return UInt16(bytes[offset]) | UInt16(bytes[offset + 1]) << 8
    }

    private static func u32(_ bytes: [UInt8], _ offset: Int) -> UInt32 {
        guard offset >= 0, offset + 4 <= bytes.count else { return 0 }
        return UInt32(bytes[offset]) | UInt32(bytes[offset + 1]) << 8
            | UInt32(bytes[offset + 2]) << 16 | UInt32(bytes[offset + 3]) << 24
    }
}
