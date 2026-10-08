import Foundation

/// GET /api/store/snapshot for stories. `full` rows are the whole library;
/// `delta` rows moved since a version and `allIds` lists every live story.
nonisolated struct StorySnapshot: Codable, Sendable {
    struct Row: Codable, Sendable {
        var id: String
        var version: String
        var row: StoryRecord
    }

    struct IdVersion: Codable, Sendable, Hashable {
        var id: String
        var version: String
    }

    var serverTime: String
    var mode: String
    var rows: [Row]
    var allIds: [IdVersion]?

    var records: [StoryRecord] { rows.map(\.row) }
}
