import Foundation

/// What an import created, and anything it could not carry over. Covers the
/// scenario, story-card, backup and card-merge responses, whose fields overlap.
nonisolated struct ImportSummary: Codable, Sendable, Hashable {
    var storyId: String
    var title: String?
    var lorebookEntryCount: Int
    var passageCount: Int?
    /// Cards left alone on a merge because the story already had that name.
    var skippedCount: Int?
    var warnings: [String]
}
