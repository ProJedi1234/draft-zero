import Foundation

/// An AI Dungeon backup as the import sheet previews it: the adventure, its
/// cards, and how its actions will land as passages.
nonisolated struct BackupPreview: Sendable, Hashable {
    var title: String
    var description: String
    /// The adventure's Plot Essentials, never its `memories` store.
    var memory: String
    var authorsNote: String
    var tags: [String]
    var worldDescription: String
    var lorebookEntries: [ImportLoreEntry]
    var settingEntries: [ImportLoreEntry]
    /// Passages the manuscript will arrive with.
    var passageCount: Int
    /// How many of those are the writer's own Do and Say turns.
    var turnCount: Int
    /// AI Dungeon's rolling summary, adopted as the first recap.
    var summary: String
    /// AI instructions, which replace the built-in narrator prompt when present.
    var instructions: String
    var warnings: [String]
}
