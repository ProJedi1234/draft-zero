import Foundation

/// The six sampling and budget knobs every profile falls back to.
nonisolated struct GenerationDefaults: Codable, Sendable, Hashable {
    var temperature: Double
    var topP: Double
    var contextWindow: Int
    var loreBudget: Double
    var frequencyPenalty: Double
    var presencePenalty: Double
}
