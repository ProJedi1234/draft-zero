import Foundation

/// One draw of an illustration slot — enough to show a thumbnail and promote it.
nonisolated struct ImageTake: Codable, Sendable, Hashable, Identifiable {
    var id: String
    var prompt: String
    var aspectRatio: ImageAspectRatio
    var mediaType: String
    var modelId: String
    var seed: Int
    var createdAt: String
}
