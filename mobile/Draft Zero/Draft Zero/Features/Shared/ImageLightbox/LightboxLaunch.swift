import Foundation

/// What a `fullScreenCover(item:)` holds to open a lightbox on one slot.
struct LightboxLaunch: Identifiable, Hashable {
    var slotID: String
    var id: String { slotID }
}
