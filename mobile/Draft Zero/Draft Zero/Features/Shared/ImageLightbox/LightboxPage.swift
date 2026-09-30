import Foundation

/// One swipeable page: a slot's shown take, or one take of a lone slot.
nonisolated struct LightboxPage: Identifiable, Hashable, Sendable {
    var id: String
    var slot: LightboxSlot
    var take: ImageTake
}
