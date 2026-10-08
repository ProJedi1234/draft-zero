import Foundation

/// What a list of AI Dungeon story cards reads as: ordinary lore, and the
/// setting bible kept apart so each import path keeps exactly one copy of it.
nonisolated struct StoryCardSet: Sendable, Hashable {
    var entries: [ImportLoreEntry]
    /// The `worldDescription` cards, as always-active entries.
    var settings: [ImportLoreEntry]
    /// Every setting card's text, joined; a new story's memory starts as this.
    var worldDescription: String
    /// The first setting card's title, which names a bare card export.
    var worldTitle: String
}
