import Foundation

/// The composer's unsent state as the server last saw it. `updatedAt` is the
/// version live `draft` events are arbitrated against.
nonisolated struct ComposerDraft: Codable, Sendable, Hashable {
    var text: String
    var mode: ComposerMode
    var imagePrompt: String?
    var imageAssisted: Bool
    var imageStyle: String?
    var imageExcludedLoreIds: [String]
    var updatedAt: String
}
