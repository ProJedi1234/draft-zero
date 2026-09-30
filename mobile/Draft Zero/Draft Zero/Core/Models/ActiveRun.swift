import Foundation

/// A run in flight on the server right now.
nonisolated struct ActiveRun: Codable, Sendable, Hashable, Identifiable {
    var storyId: String
    var runId: String
    /// Server wall clock; elapsed time counts from here, not from when we looked.
    var startedAt: String

    var id: String { runId }
}
