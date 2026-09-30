import Foundation

/// One lab's models, in the order the catalog lists them.
nonisolated struct ProviderGroup<Entry: CatalogEntry>: Identifiable, Sendable {
    var provider: String
    var entries: [Entry]

    var id: String { provider }
}
