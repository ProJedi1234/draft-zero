import Foundation

/// The composer's whole unsent state, travelling as one payload because the
/// words and the move they are armed under are inseparable.
nonisolated struct DraftPayload: Sendable, Hashable {
    var text: String
    var mode: ComposerMode
    var imagePrompt: String?
    var imageAssisted: Bool
    var imageStyle: String?
    var imageExcludedLoreIds: [String]
}
