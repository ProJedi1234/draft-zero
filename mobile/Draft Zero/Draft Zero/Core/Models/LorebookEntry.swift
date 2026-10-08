import Foundation

/// One lorebook card, scoped to its story. Mirrors `LorebookEntry` in lib/types.ts.
nonisolated struct LorebookEntry: Codable, Sendable, Hashable, Identifiable {
    var id: String
    var storyId: String
    var name: String
    var category: LorebookCategory
    /// Keywords that activate the entry when seen in recent text.
    var keys: [String]
    var content: String
    var enabled: Bool
    /// In context regardless of keys.
    var alwaysActive: Bool
    /// 0–100; higher survives context trimming longer.
    var priority: Int
    var createdAt: String
    var updatedAt: String
}
