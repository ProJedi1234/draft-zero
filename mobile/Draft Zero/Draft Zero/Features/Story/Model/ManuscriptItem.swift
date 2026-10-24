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

    /// A turn opens with the writer's move, or with a passage the model wrote
    /// unprompted (Continue). A reply and its pictures stay with the move.
    func startsTurn(after previous: ManuscriptItem?) -> Bool {
        guard previous != nil, case .entry(let entry) = self else { return false }
        if entry.source == .user { return true }
        if case .entry(let prior) = previous, prior.source == .user { return false }
        return true
    }
}
