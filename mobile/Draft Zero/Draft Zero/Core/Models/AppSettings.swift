import Foundation

/// The app-wide settings row. Mirrors `AppSettings` in lib/types.ts.
nonisolated struct AppSettings: Codable, Sendable, Hashable {
    /// What writes rolling story summaries. A nil model follows the built-in default.
    struct Summarizer: Codable, Sendable, Hashable {
        var modelId: String?
        var thinking: ThinkingLevel
        var providerTag: String?
        var zdr: Bool
        var temperature: Double
        /// Words the recap aims for, or nil to scale with the story's window.
        var targetWords: Double?
        /// Hard output cap, or nil to derive it from the target.
        var maxTokens: Double?

        func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(modelId, forKey: .modelId)
            try container.encode(thinking, forKey: .thinking)
            try container.encode(providerTag, forKey: .providerTag)
            try container.encode(zdr, forKey: .zdr)
            try container.encode(temperature, forKey: .temperature)
            try container.encode(targetWords, forKey: .targetWords)
            try container.encode(maxTokens, forKey: .maxTokens)
        }
    }

    /// What picks a story's tint once the scene has moved.
    struct Atmosphere: Codable, Sendable, Hashable {
        enum Engine: String, Codable, Sendable, CaseIterable, Identifiable {
            case llm
            case decision
            var id: String { rawValue }
            var label: String {
                switch self {
                case .llm: "Language model"
                case .decision: "Decision model"
                }
            }
        }

        var engine: Engine
        /// How sure the decision engine must be before repainting, 0.5–0.95.
        var minConfidence: Double
        /// The decision model, or nil for `BuiltInModels.atmosphereDecision`.
        /// Absent from a server older than the decision picker.
        var decisionModelId: String?
        var modelId: String?
        var thinking: ThinkingLevel
        var providerTag: String?
        var zdr: Bool
        var temperature: Double
        var maxTokens: Int
        var passagesBetweenChecks: Int

        func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(engine, forKey: .engine)
            try container.encode(minConfidence, forKey: .minConfidence)
            try container.encode(decisionModelId, forKey: .decisionModelId)
            try container.encode(modelId, forKey: .modelId)
            try container.encode(thinking, forKey: .thinking)
            try container.encode(providerTag, forKey: .providerTag)
            try container.encode(zdr, forKey: .zdr)
            try container.encode(temperature, forKey: .temperature)
            try container.encode(maxTokens, forKey: .maxTokens)
            try container.encode(passagesBetweenChecks, forKey: .passagesBetweenChecks)
        }
    }

    /// The profile new stories start from.
    var defaultProfileId: String?
    var defaultGeneration: GenerationDefaults
    var summarizer: Summarizer
    var atmosphere: Atmosphere
    /// Zero data retention for every story and profile — a floor, not a default.
    var requireZdr: Bool
    /// The image model stories draw with unless they chose one; nil follows the catalog.
    var defaultImageModelId: String?
    /// The develop call's context budget in tokens; one of `GenerationLimits.imageContextOptions`.
    var imageContextTokens: Int
}
