import Foundation

/// One story's run of pictures in the by-story layout.
nonisolated struct GallerySection: Identifiable, Hashable, Sendable {
    var storyId: String
    var title: String
    var tint: StoryTintValue
    var images: [GalleryImage]

    var id: String { storyId }
}
