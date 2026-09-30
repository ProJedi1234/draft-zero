import Foundation

/// One beat of the manuscript: a passage or a picture, ordered by the
/// position counter they share.
enum ManuscriptItem: Identifiable, Hashable {
    case entry(StoryEntry)
    case image(StoryImage)

    var id: String {
        switch self {
        case .entry(let entry): "entry-\(entry.variantGroupId)"
        case .image(let image): "image-\(image.imageGroupId)"
        }
    }

    var position: Int {
        switch self {
        case .entry(let entry): entry.position ?? 0
        case .image(let image): image.position
        }
    }
}
