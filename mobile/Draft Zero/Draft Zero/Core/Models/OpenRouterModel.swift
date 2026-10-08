import Foundation

/// One entry of OpenRouter's text catalog. Mirrors `OpenRouterModel` in lib/types.ts.
nonisolated struct OpenRouterModel: Codable, Sendable, Hashable, Identifiable {
    struct Pricing: Codable, Sendable, Hashable {
        /// USD per 1M tokens, preformatted, e.g. "$3.00".
        var prompt: String
        var completion: String
    }

    struct Reasoning: Codable, Sendable, Hashable {
        /// Efforts this model accepts, lowest first. Never contains `off`.
        var efforts: [ThinkingLevel]
        /// The model always thinks, so `off` cannot be honoured.
        var mandatory: Bool
    }

    var id: String
    var name: String
    var provider: String
    var contextLength: Int
    var maxCompletionTokens: Int?
    var pricing: Pricing
    var reasoning: Reasoning?
    /// At least one endpoint retains nothing, so the model is usable under ZDR.
    var zdr: Bool
    /// For a "~lab/family-latest" alias, the concrete model it points at.
    var aliasTarget: String?
}
