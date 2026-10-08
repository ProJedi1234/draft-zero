import Foundation

/// One illustration slot on the gallery wall, with enough of its story to
/// caption and group it.
nonisolated struct GalleryImage: Codable, Sendable, Hashable, Identifiable {
    var id: String
    var prompt: String
    var aspectRatio: ImageAspectRatio
    var mediaType: String
    var modelId: String
    var createdAt: String
    var storyId: String
    var storyTitle: String
    var tintHue: Double?
    var tintStrength: Double
    var imageGroupId: String
    /// Position of the active take in `takes`.
    var imageIndex: Int
    /// Every take of the slot, oldest first.
    var takes: [ImageTake]
    /// The active take's file is gone. Optional because the server omits it
    /// when the file exists, and caches saved before it existed lack it.
    var missing: Bool?

    var tint: StoryTintValue { StoryTintValue(hue: tintHue, strength: tintStrength) }
}
