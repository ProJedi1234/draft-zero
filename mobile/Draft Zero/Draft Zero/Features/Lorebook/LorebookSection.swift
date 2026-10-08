import Foundation

/// One category's entries, as the unfiltered list groups them.
nonisolated struct LorebookSection: Identifiable, Sendable, Equatable {
    var category: LorebookCategory
    var entries: [LorebookEntry]
    var id: LorebookCategory { category }
}
