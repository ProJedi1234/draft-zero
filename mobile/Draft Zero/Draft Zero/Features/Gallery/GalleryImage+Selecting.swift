import Foundation

extension GalleryImage {
    /// The row as it reads once `take` is the slot's active one; a wall row
    /// mirrors its active take. Nil when the take is not in this slot.
    func selecting(_ take: ImageTake) -> GalleryImage? {
        guard let index = takes.firstIndex(where: { $0.id == take.id }) else { return nil }
        var row = self
        row.id = take.id
        row.prompt = take.prompt
        row.aspectRatio = take.aspectRatio
        row.mediaType = take.mediaType
        row.modelId = take.modelId
        row.createdAt = take.createdAt
        row.imageIndex = index
        return row
    }

    var lightboxSlot: LightboxSlot {
        LightboxSlot(
            id: imageGroupId,
            takes: takes,
            activeTakeId: takes.indices.contains(imageIndex) ? takes[imageIndex].id : id,
            storyId: storyId,
            storyTitle: storyTitle
        )
    }
}
