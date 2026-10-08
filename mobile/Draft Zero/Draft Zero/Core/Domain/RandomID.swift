import Foundation

/// Client-minted ids, in the shape the server's entity-id check accepts.
nonisolated enum RandomID {
    /// A v4 UUID, lowercased, as lib/id.ts mints them.
    static func make() -> String {
        UUID().uuidString.lowercased()
    }

    /// A short alphanumeric id with no separator, for the sync origin. The
    /// server's own origins carry a colon, so they can never collide.
    static func origin() -> String {
        let alphabet = Array("abcdefghijklmnopqrstuvwxyz0123456789")
        return String((0..<16).map { _ in alphabet.randomElement() ?? "a" })
    }
}
