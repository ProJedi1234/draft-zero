import Foundation

/// One illustration slot as the lightbox shows it: every take, and which one
/// the story is using.
nonisolated struct LightboxSlot: Identifiable, Hashable, Sendable {
    /// The slot's `imageGroupId`.
    var id: String
    /// Every take, oldest first.
    var takes: [ImageTake]
    var activeTakeId: String
    /// Named in the caption; a lightbox opened from inside a story may leave both out.
    var storyId: String?
    var storyTitle: String?

    /// The take a caller may show first: the active one, or the first if the id is stale.
    var activeTake: ImageTake? {
        takes.first { $0.id == activeTakeId } ?? takes.first
    }
}
