import Foundation

nonisolated struct StoryFeatures: Codable, Sendable, Hashable {
    struct World: Codable, Sendable, Hashable {
        var enabled: Bool
        var pacing: String
    }

    var world: World?
}
