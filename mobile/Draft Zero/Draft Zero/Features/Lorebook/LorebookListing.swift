import Foundation

/// How the list orders, filters, groups and re-selects entries. Pure, so the
/// rules are testable apart from the screen.
nonisolated enum LorebookListing {
    /// Name order, as the server returns lore, with the id to break ties.
    static func sorted(_ entries: [LorebookEntry]) -> [String] {
        entries.sorted { a, b in
            let order = a.name.localizedStandardCompare(b.name)
            return order == .orderedSame ? a.id < b.id : order == .orderedAscending
        }
        .map(\.id)
    }

    /// Keeps the rendered order while the set of entries is unchanged, so a row
    /// being renamed does not walk through the list under the writer's cursor.
    /// Any entry appearing or disappearing re-sorts the whole list.
    static func stableOrder(previous: [String], entries: [LorebookEntry]) -> [String] {
        if Set(previous) == Set(entries.map(\.id)), previous.count == entries.count {
            return previous
        }
        return sorted(entries)
    }

    /// Case- and diacritic-insensitive search over name, keys and content.
    static func matches(_ entry: LorebookEntry, query: String) -> Bool {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if needle.isEmpty { return true }
        return entry.name.localizedStandardContains(needle)
            || entry.keys.contains { $0.localizedStandardContains(needle) }
            || entry.content.localizedStandardContains(needle)
    }

    static func visible(_ ordered: [LorebookEntry], filter: LorebookFilter, query: String) -> [LorebookEntry] {
        ordered.filter { filter.admits($0) && matches($0, query: query) }
    }

    /// Non-empty categories in the enum's order, each keeping the list's order.
    static func sections(_ ordered: [LorebookEntry]) -> [LorebookSection] {
        let grouped = Dictionary(grouping: ordered, by: \.category)
        return LorebookCategory.allCases.compactMap { category in
            guard let entries = grouped[category], !entries.isEmpty else { return nil }
            return LorebookSection(category: category, entries: entries)
        }
    }

    /// The entry that inherits the selection when the selected one disappears:
    /// the next in list order, else the previous, else the first survivor.
    static func nextSelection(previousOrder: [String], alive: [String], gone: String) -> String? {
        let living = Set(alive)
        if let index = previousOrder.firstIndex(of: gone) {
            if let next = previousOrder[(index + 1)...].first(where: living.contains) { return next }
            if let previous = previousOrder[..<index].last(where: living.contains) { return previous }
        }
        return alive.first
    }
}
