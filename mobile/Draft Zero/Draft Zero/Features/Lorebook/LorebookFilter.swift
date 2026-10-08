import Foundation

/// Which slice of the lorebook the list shows.
nonisolated enum LorebookFilter: Hashable, Sendable {
    case all
    case category(LorebookCategory)

    var category: LorebookCategory? {
        if case .category(let category) = self { category } else { nil }
    }

    var title: String {
        category?.pluralLabel ?? "All Entries"
    }

    var systemImage: String {
        category?.systemImage ?? "books.vertical"
    }

    func admits(_ entry: LorebookEntry) -> Bool {
        guard let category else { return true }
        return entry.category == category
    }
}
