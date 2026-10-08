import Foundation

/// Where trigger keys are looked for. A port of `buildScanSources` and
/// `recentStoryText` in lib/generation/lorebook.ts, so the inspector lists the
/// entries the server will actually send.
nonisolated enum LoreScan {
    /// How many trailing passages the scan window reads. Fixed on purpose:
    /// activation must not move with the context-window slider.
    static let entryCount = 4
    /// The scan window's cap, in UTF-16 units as JavaScript counts them.
    static let charLimit = 4000

    /// The last four passages joined by blank lines, the final 4000 characters
    /// of that, lowercased.
    static func recentStoryText(_ entries: [StoryEntry]) -> String {
        let joined = entries.suffix(entryCount).map(\.text).joined(separator: "\n\n")
        let units = joined.utf16
        guard units.count > charLimit else { return joined.lowercased() }
        let start = units.index(units.endIndex, offsetBy: -charLimit)
        // A cut through a surrogate pair decodes to U+FFFD, which no key matches,
        // just as the lone surrogate JavaScript's slice leaves matches nothing.
        return String(decoding: units[start...], as: UTF16.self).lowercased()
    }

    /// Memory, the author's note, then recent prose. The order decides which
    /// source an entry is credited to, and memory or the note make it stable.
    static func sources(memory: String, authorsNote: String, entries: [StoryEntry]) -> [LoreMatcher.ScanSource] {
        [
            LoreMatcher.ScanSource(id: .memory, text: memory.lowercased()),
            LoreMatcher.ScanSource(id: .authorsNote, text: authorsNote.lowercased()),
            LoreMatcher.ScanSource(id: .story, text: recentStoryText(entries)),
        ]
    }

    /// The entries in context for a story as the server holds it.
    static func activeEntries(in lorebook: [LorebookEntry], story: Story) -> [LoreMatcher.Match] {
        LoreMatcher.matchActive(
            lorebook,
            sources: sources(memory: story.memory, authorsNote: story.authorsNote, entries: story.entries)
        )
    }
}
