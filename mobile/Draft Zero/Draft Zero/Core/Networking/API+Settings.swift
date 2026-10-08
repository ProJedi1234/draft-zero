import Foundation

/// The answer to a key check. A failed check is a result, not an error.
nonisolated struct KeyVerification: Decodable, Sendable {
    var verified: Bool
    var message: String
}

extension APIClient {
    /// GET /api/settings — the settings screen's whole payload.
    func settingsPayload() async throws -> SettingsPayload {
        try await payload(.get, "api/settings")
    }

    /// PATCH /api/settings — any of summarizer, atmosphere, requireZdr,
    /// defaultImageModelId, imageContextTokens. Nested bundles are sent whole.
    func updateAppSettings(_ patch: JSONObject) async throws {
        try await serviceVoid(.patch, "api/settings", body: patch)
    }

    func updateSummarizer(_ summarizer: AppSettings.Summarizer) async throws {
        try await serviceVoid(.patch, "api/settings", body: ["summarizer": try JSONValue.encoding(summarizer)])
    }

    func updateAtmosphere(_ atmosphere: AppSettings.Atmosphere) async throws {
        try await serviceVoid(.patch, "api/settings", body: ["atmosphere": try JSONValue.encoding(atmosphere)])
    }

    /// PATCH /api/settings/generation-defaults — a partial GenerationDefaults.
    func updateGenerationDefaults(_ patch: JSONObject) async throws {
        try await serviceVoid(.patch, "api/settings/generation-defaults", body: patch)
    }

    /// POST /api/settings/verify-key — checks the server's OpenRouter key. Never echoes it.
    func verifyOpenRouterKey() async throws -> KeyVerification {
        try await service(.post, "api/settings/verify-key")
    }

    /// GET /api/zdr — the account's retention verdict per model group.
    func accountZdrPolicies() async throws -> [String: AccountZdrPolicy] {
        try await service(.get, "api/zdr")
    }

    /// GET /api/zdr/:model — the verdict for one model's group.
    func accountZdrPolicy(modelId: String) async throws -> AccountZdrPolicy {
        try await service(.get, "api/zdr/\(modelId)")
    }

    /// GET /api/models/endpoints/:model — the endpoints serving one model.
    func modelEndpoints(modelId: String) async throws -> [ModelEndpoint] {
        try await service(.get, "api/models/endpoints/\(modelId)")
    }
}

nonisolated extension JSONValue {
    /// Round-trips an Encodable value into a JSONValue.
    static func encoding<T: Encodable>(_ value: T) throws -> JSONValue {
        let data = try JSONEncoder().encode(value)
        return try JSONDecoder().decode(JSONValue.self, from: data)
    }
}
