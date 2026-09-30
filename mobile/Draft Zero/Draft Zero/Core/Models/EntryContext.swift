import Foundation

/// What a passage would be sent now, composed from the manuscript before it.
/// From GET /api/entries/:id/context.
nonisolated struct EntryContext: Codable, Sendable {
    var context: ComposedContext
    /// The budget it was composed against, clamped as a real request is.
    var contextWindow: Int
    var modelId: String?
}
