import Foundation

/// The settings screen's data, from GET /api/settings. Mirrors lib/payloads/settings.ts.
nonisolated struct SettingsPayload: Codable, Sendable {
    var settings: AppSettings
    var models: [OpenRouterModel]
    var imageModels: [OpenRouterImageModel]
    var defaultImagePrice: String?
    var profiles: [ModelProfile]
    /// Stories following each profile; a missing id means none.
    var followerCounts: [String: Int]
}
