import Foundation

/// What a profile stores: a required model identity, and sliders that are nil
/// when they defer to the app-wide defaults.
nonisolated struct ProfileSettings: Codable, Sendable, Hashable {
    var modelId: String
    var thinking: ThinkingLevel
    var providerTag: String?
    var zdr: Bool
    var temperature: Double?
    var topP: Double?
    var contextWindow: Int?
    var loreBudget: Double?
    var frequencyPenalty: Double?
    var presencePenalty: Double?

    /// Encodes every key, nil as JSON null, because the server schema requires them.
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(modelId, forKey: .modelId)
        try container.encode(thinking, forKey: .thinking)
        try container.encode(providerTag, forKey: .providerTag)
        try container.encode(zdr, forKey: .zdr)
        try container.encode(temperature, forKey: .temperature)
        try container.encode(topP, forKey: .topP)
        try container.encode(contextWindow, forKey: .contextWindow)
        try container.encode(loreBudget, forKey: .loreBudget)
        try container.encode(frequencyPenalty, forKey: .frequencyPenalty)
        try container.encode(presencePenalty, forKey: .presencePenalty)
    }
}
