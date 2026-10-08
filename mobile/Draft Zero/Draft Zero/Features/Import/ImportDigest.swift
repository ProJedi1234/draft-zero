import Foundation

/// How a preview sums up a field or a lorebook, shared by all three formats so
/// they can't disagree about the same file. Mirrors components/import/import-summary.tsx.
nonisolated enum ImportDigest {
    /// "Empty", "1 word", "240 words".
    static func words(_ text: String) -> String {
        let words = text.split(whereSeparator: \.isWhitespace).count
        return words == 0 ? "Empty" : ImportText.count(words, "word", "words")
    }

    /// "None", "1 entry", "25 entries".
    static func entries(_ count: Int) -> String {
        count == 0 ? "None" : ImportText.count(count, "entry", "entries")
    }

    /// ["8 Locations", "3 Factions"], in the app's own category order.
    static func categoryBreakdown(_ entries: [ImportLoreEntry]) -> [String] {
        LorebookCategory.allCases.compactMap { category in
            let count = entries.count { $0.category == category }
            guard count > 0 else { return nil }
            return "\(count.formatted()) \(count == 1 ? category.label : category.pluralLabel)"
        }
    }
}

extension ImportDigest {
    /// "None", or "8 Locations · 3 Factions".
    static func categories(_ entries: [ImportLoreEntry]) -> String {
        let breakdown = categoryBreakdown(entries)
        return breakdown.isEmpty ? "None" : breakdown.joined(separator: " · ")
    }

    /// A backup's manuscript: "Empty", or "412 passages · 205 of them yours".
    static func manuscript(passages: Int, turns: Int) -> String {
        guard passages > 0 else { return "Empty" }
        let count = ImportText.count(passages, "passage", "passages")
        return turns > 0 ? "\(count) · \(turns.formatted()) of them yours" : count
    }

    /// Whether AI instructions replace the narrator prompt.
    static func narrator(_ instructions: String) -> String {
        instructions.isEmpty ? "Built-in" : "Replaced · \(words(instructions))"
    }
}
