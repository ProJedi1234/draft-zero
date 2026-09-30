import Foundation

/// What a story-card merge did, shaped for the summary sheet.
nonisolated struct LorebookMergeReport: Identifiable, Sendable {
    let id = UUID()
    var added: Int
    /// Cards left alone because the lorebook already had an entry by that name.
    var skipped: Int
    /// The reader's warnings, minus the skip line the counts already say.
    var warnings: [String]

    init(_ summary: ImportSummary) {
        added = summary.lorebookEntryCount
        skipped = summary.skippedCount ?? 0
        let skipLine = Self.skipWarning(skipped)
        warnings = summary.warnings.filter { $0 != skipLine }
    }

    var headline: String {
        if added == 0 { return skipped > 0 ? "Already in the Lorebook" : "Nothing to Add" }
        return added == 1 ? "Added 1 Entry" : "Added \(added) Entries"
    }

    /// The line lib/services/import.ts appends when it skips cards.
    static func skipWarning(_ skipped: Int) -> String {
        "Skipped \(skipped) \(skipped == 1 ? "card" : "cards") already in this lorebook by name."
    }
}
