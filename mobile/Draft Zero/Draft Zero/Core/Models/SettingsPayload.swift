import Foundation

/// The settings screen's data, from GET /api/settings. Mirrors lib/payloads/settings.ts.
nonisolated struct SettingsPayload: Codable, Sendable {
    var settings: AppSettings
    var models: [OpenRouterModel]
    /// Every System One model the atmosphere check can use. Nil from an older server.
    var decisionModels: [DecisionModel]?
    /// The local Ollama host, or nil when the server has none (or predates them).
    var localModels: LocalModelsStatus?
    var imageModels: [OpenRouterImageModel]
    var defaultImagePrice: String?
    var profiles: [ModelProfile]
    /// Stories following each profile; a missing id means none.
    var followerCounts: [String: Int]
}
