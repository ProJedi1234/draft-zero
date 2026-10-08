import Foundation

/// A story's effective generation settings: its followed profile's, or its own.
/// Mirrors `GenerationSettings` in lib/types.ts.
nonisolated struct GenerationSettings: Codable, Sendable, Hashable {
    /// OpenRouter model id, e.g. "~anthropic/claude-sonnet-latest".
    var modelId: String
    var thinking: ThinkingLevel
    /// An OpenRouter endpoint tag, or nil for Auto routing.
    var providerTag: String?
    /// Route only through endpoints that retain nothing.
    var zdr: Bool
    var temperature: Double
    var topP: Double
    /// Input context budget in tokens; always one of `GenerationLimits.contextWindows`.
    var contextWindow: Int
    /// Percentage (0–50) of the free context the lorebook may claim.
    var loreBudget: Double
    var frequencyPenalty: Double
    var presencePenalty: Double
}
