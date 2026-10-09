import Foundation

/// Grouping, filtering and coupling rules shared by every model picker.
nonisolated enum ModelCatalog {
    /// Which entries a retention policy leaves pickable. Blocked entries are kept
    /// so a writer can see why a model is missing rather than hunt for it.
    static func partition<Entry: CatalogEntry>(_ entries: [Entry], zdr: Bool) -> (allowed: [Entry], blocked: [Entry]) {
        guard zdr else { return (entries, []) }
        return (entries.filter(\.zdr), entries.filter { !$0.zdr })
    }

    /// Groups by provider, keeping the catalog's order within and across groups.
    static func groupByProvider<Entry: CatalogEntry>(_ entries: [Entry]) -> [ProviderGroup<Entry>] {
        var groups: [ProviderGroup<Entry>] = []
        var index: [String: Int] = [:]
        for entry in entries {
            if let position = index[entry.provider] {
                groups[position].entries.append(entry)
            } else {
                index[entry.provider] = groups.count
                groups.append(ProviderGroup(provider: entry.provider, entries: [entry]))
            }
        }
        return groups
    }

    /// Matches the name, the lab, the id and, for aliases, what they point at.
    static func matches<Entry: CatalogEntry>(_ entry: Entry, query: String) -> Bool {
        let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return true }
        return ([entry.name, entry.provider] + entry.searchAliases).contains { $0.localizedStandardContains(query) }
    }

    static func filter<Entry: CatalogEntry>(_ entries: [Entry], query: String) -> [Entry] {
        entries.filter { matches($0, query: query) }
    }

    /// The half of the catalog the Local/External switch leaves showing.
    static func filter<Entry: CatalogEntry>(_ entries: [Entry], source: ModelSource) -> [Entry] {
        switch source {
        case .all: entries
        case .local: entries.filter { $0.local != nil }
        case .external: entries.filter { $0.local == nil }
        }
    }

    /// The level to keep when the model changes: the current one if the new
    /// model offers it, otherwise off — never one that would be rejected on send.
    static func levelForModel(_ reasoning: OpenRouterModel.Reasoning?, current: ThinkingLevel) -> ThinkingLevel {
        guard current != .off, let reasoning else { return .off }
        return reasoning.efforts.contains(current) ? current : .off
    }

    /// Off plus every effort the model accepts. A stored level the model no longer
    /// offers stays listed, so the picker never shows a blank selection.
    static func thinkingOptions(_ reasoning: OpenRouterModel.Reasoning?, current: ThinkingLevel) -> [ThinkingLevel] {
        var levels: [ThinkingLevel] = [.off] + (reasoning?.efforts ?? [])
        if !levels.contains(current) { levels.append(current) }
        return levels
    }

    /// "Claude Sonnet Latest", or the bare id of a model the catalog no longer lists.
    static func displayName(_ modelId: String, in models: [OpenRouterModel]) -> String {
        models.first { $0.id == modelId }?.name ?? modelId
    }
}
