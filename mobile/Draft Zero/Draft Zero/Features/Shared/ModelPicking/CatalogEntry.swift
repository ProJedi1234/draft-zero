import Foundation

/// What the text and image catalogs share, so grouping and search are written once.
nonisolated protocol CatalogEntry: Identifiable, Sendable where ID == String {
    var id: String { get }
    var name: String { get }
    var provider: String { get }
    /// At least one endpoint retains nothing.
    var zdr: Bool { get }
    /// Extra text a search should match beyond the name and provider.
    var searchAliases: [String] { get }
    /// Set when the local Ollama host serves this entry.
    var local: OpenRouterModel.Local? { get }
}

nonisolated extension OpenRouterModel: CatalogEntry {
    var searchAliases: [String] { [id, aliasTarget, local.map { _ in "local" }].compactMap { $0 } }
}

nonisolated extension OpenRouterImageModel: CatalogEntry {
    var searchAliases: [String] { [id] }
    var local: OpenRouterModel.Local? { nil }
}

nonisolated extension DecisionModel: CatalogEntry {
    var searchAliases: [String] { [id, local.map { _ in "local" }].compactMap { $0 } }
}
