import Foundation

/// The local Ollama host as Settings reports it. Mirrors `LocalModelsStatus` in lib/types.ts.
nonisolated struct LocalModelsStatus: Codable, Sendable, Hashable {
    struct Loaded: Codable, Sendable, Hashable {
        var modelId: String
        var name: String
        /// ISO-8601, when Ollama will unload it.
        var expiresAt: String?
    }

    var host: String
    var baseUrl: String
    var reachable: Bool
    var version: String?
    var chatModels: Int
    var decisionModels: Int
    /// The context window sent with every local request.
    var contextWindow: Int
    var loaded: [Loaded]
}
