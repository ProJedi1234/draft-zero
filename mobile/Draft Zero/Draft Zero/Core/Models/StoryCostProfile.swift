import Foundation

/// Everything the per-story cost surfaces need. USD figures are decimal strings.
nonisolated struct StoryCostProfile: Codable, Sendable, Hashable {
    struct ModelShare: Codable, Sendable, Hashable, Identifiable {
        var modelId: String
        var costUsd: String
        var calls: Int
        var id: String { modelId }
    }

    struct EntrySpend: Codable, Sendable, Hashable, Identifiable {
        var entryId: String
        var position: Int
        var costUsd: String?
        var id: String { entryId }
    }

    var totalUsd: String
    var calls: Int
    /// Settled calls with no price — the "+" in "$0.42+".
    var unpricedCalls: Int
    var abortedCalls: Int
    var promptTokens: Int
    var completionTokens: Int
    var perModel: [ModelShare]
    var perEntry: [EntrySpend]
}
