import Foundation

/// The two layouts' orderings. Grouping is presentation, so the same rows
/// serve both and switching costs no request.
nonisolated enum GalleryGrouping {
    /// Sections in first-appearance order, which over a newest-first list puts
    /// the stories with the newest pictures first. Each keeps its pictures in
    /// the order given, and takes its title and tint from its first picture.
    static func sections(_ images: [GalleryImage]) -> [GallerySection] {
        var order: [String] = []
        var byStory: [String: GallerySection] = [:]
        for image in images {
            if byStory[image.storyId] == nil {
                order.append(image.storyId)
                byStory[image.storyId] = GallerySection(
                    storyId: image.storyId,
                    title: image.storyTitle,
                    tint: image.tint,
                    images: []
                )
            }
            byStory[image.storyId]?.images.append(image)
        }
        return order.compactMap { byStory[$0] }
    }

    /// The pictures in the order the layout shows them, which is the order a
    /// lightbox pages through.
    static func displayed(_ images: [GalleryImage], by order: GalleryOrder) -> [GalleryImage] {
        switch order {
        case .newest: images
        case .byStory: sections(images).flatMap(\.images)
        }
    }
}
