import Foundation

/// A NovelAI scenario as the import sheet previews it, before anything is written.
nonisolated struct ScenarioPreview: Sendable, Hashable {
    var scenarioVersion: Double
    var title: String
    var description: String
    var author: String
    var genre: String
    var tags: [String]
    /// The opening passage, under the paragraph contract.
    var prompt: String
    var memory: String
    var authorsNote: String
    var lorebookEntries: [ImportLoreEntry]
    var placeholders: [ScenarioPlaceholder]
    /// What was dropped or coerced, in the reader's own words.
    var warnings: [String]
}
