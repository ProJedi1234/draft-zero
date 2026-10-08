import Foundation

/// One entry of OpenRouter's image catalog.
nonisolated struct OpenRouterImageModel: Codable, Sendable, Hashable, Identifiable {
    var id: String
    var name: String
    var provider: String
    var zdr: Bool
}
