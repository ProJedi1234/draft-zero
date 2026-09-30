import Foundation

/// One file in a zip's central directory, still compressed.
nonisolated struct ZipEntry: Sendable, Hashable {
    var name: String
    var method: Int
    var compressedSize: Int
    /// What the directory claims; a pre-check only, since a bomb lies here.
    var uncompressedSize: Int
    var localHeaderOffset: Int
}
