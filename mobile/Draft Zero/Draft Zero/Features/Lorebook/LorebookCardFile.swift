import Foundation

/// Reads a picked AI Dungeon card export off the main actor.
nonisolated enum LorebookCardFile {
    enum ReadError: LocalizedError {
        case tooLarge
        case unreadable
        case notText

        var errorDescription: String? {
            switch self {
            case .tooLarge: "That file is too large to be a story-card export."
            case .unreadable: "That file couldn't be read. Try picking it again."
            case .notText: "That file isn't a text export."
            }
        }
    }

    /// The server refuses anything larger (MAX_CARDS_BYTES in lib/import/aidungeon.ts).
    static let maxBytes = 1024 * 1024

    @concurrent
    static func read(_ url: URL) async throws -> String {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        if let size = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize, size > maxBytes {
            throw ReadError.tooLarge
        }
        let data: Data
        do {
            data = try Data(contentsOf: url)
        } catch {
            throw ReadError.unreadable
        }
        guard data.count <= maxBytes else { throw ReadError.tooLarge }
        guard let text = String(data: data, encoding: .utf8) else { throw ReadError.notText }
        return text
    }
}
