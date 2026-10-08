import Foundation

/// The composer as this device last left a story. `version` is the server row
/// the text matches, or was typed on top of; `unsent` holds until the server
/// acknowledges the text.
nonisolated struct LocalDraft: Codable, Sendable, Equatable {
    var payload: DraftPayload
    var version: String?
    var unsent: Bool
}
