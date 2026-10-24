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
    func startsTurn(following earlier: some BidirectionalCollection<ManuscriptItem>) -> Bool {
        guard !earlier.isEmpty, case .entry(let entry) = self else { return false }
        return entry.source == .user || !Self.endsOnMove(earlier)
    }

    /// Whether the latest passage is the writer's move, looking past any pictures.
    static func endsOnMove(_ items: some BidirectionalCollection<ManuscriptItem>) -> Bool {
        for item in items.reversed() {
            if case .entry(let entry) = item { return entry.source == .user }
        }
        return false
    }
}
