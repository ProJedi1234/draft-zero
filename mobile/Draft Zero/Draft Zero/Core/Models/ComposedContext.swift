import Foundation

/// A fully composed generation context. Mirrors `ComposedContext` in
/// lib/generation/types.ts.
nonisolated struct ComposedContext: Codable, Sendable {
    /// A lorebook entry selected into context, and why.
    struct LoreEntry: Codable, Sendable, Hashable, Identifiable {
        var id: String
        var name: String
        var content: String
        var priority: Int
        /// The key that matched, or nil for an always-on entry.
        var matchedKey: String?
        /// Cascade rounds from a scan source; 0 is direct or always-on.
        var depth: Int
        var triggeredBy: LoreTrigger?
        /// Independent of the story window, so sent in the cacheable head.
        var stable: Bool
    }

    struct Fit: Codable, Sendable, Hashable {
        var loreMatched: Int
        var loreStableMatched: Int
        var storyChars: Int
        var storyCharsKept: Int
    }

    var systemPrompt: String
    var memory: String
    var lore: [LoreEntry]
    var summary: String
    var storyText: String
    var authorsNote: String
    var seed: Int
    var approxTokens: Int
    var fit: Fit
}
