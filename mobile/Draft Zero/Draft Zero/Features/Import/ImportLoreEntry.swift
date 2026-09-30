import Foundation

/// A lorebook entry an import would create, reduced to what a preview shows.
nonisolated struct ImportLoreEntry: Sendable, Hashable {
    var name: String
    var category: LorebookCategory
    var keys: [String]
    var content: String
    var enabled: Bool
    var alwaysActive: Bool
}
