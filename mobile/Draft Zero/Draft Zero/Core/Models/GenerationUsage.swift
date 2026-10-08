import Foundation

/// Exact token counts from the provider's final usage event.
nonisolated struct GenerationUsage: Codable, Sendable, Hashable {
    var promptTokens: Int
    var completionTokens: Int
    var reasoningTokens: Int
    var costUsd: Double?
    var cachedPromptTokens: Int?
}
