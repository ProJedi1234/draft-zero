import Foundation

/// A zip this reader refuses, by name rather than by misreading it.
nonisolated struct ZipArchiveError: LocalizedError, Equatable, Sendable {
    var message: String

    var errorDescription: String? { message }

    static let bomb = ZipArchiveError(
        message: "That zip expands to far more than it should — it looks like a decompression bomb."
    )
}
