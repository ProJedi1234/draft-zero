import Foundation

/// An AI Dungeon story-card export as the import sheet previews it.
nonisolated struct StoryCardsPreview: Sendable, Hashable {
    var title: String
    var description: String
    var prompt: String
    var memory: String
    var authorsNote: String
    var tags: [String]
    var worldDescription: String
    /// Ordinary lore; never a setting card.
    var lorebookEntries: [ImportLoreEntry]
    var settingEntries: [ImportLoreEntry]
    var warnings: [String]
}
