import Foundation

extension LightboxSlot {
    /// A story's own picture, for the story screen to open its takes.
    init(_ image: StoryImage, storyId: String, storyTitle: String?) {
        self.init(
            id: image.imageGroupId,
            takes: image.takes,
            activeTakeId: image.takes.indices.contains(image.imageIndex) ? image.takes[image.imageIndex].id : image.id,
            storyId: storyId,
            storyTitle: storyTitle
        )
    }
}
