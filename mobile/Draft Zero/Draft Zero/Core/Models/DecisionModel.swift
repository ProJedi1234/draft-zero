import Foundation

/// One System One decision model. Mirrors `DecisionModel` in lib/types.ts.
nonisolated struct DecisionModel: Codable, Sendable, Hashable, Identifiable {
    var id: String
    var name: String
    var provider: String
    /// 0 when the catalog doesn't publish one.
    var contextLength: Int
    /// USD per 1M input tokens, preformatted. Output is not billed.
    var promptPrice: String
    var inputModalities: [String]
    /// Usable under zero data retention. Always true for a local model.
    var zdr: Bool
    var local: OpenRouterModel.Local?
}
