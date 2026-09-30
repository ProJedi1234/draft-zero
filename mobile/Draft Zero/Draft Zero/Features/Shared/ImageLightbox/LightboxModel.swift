import Foundation
import Observation

/// Which picture and which take the lightbox is on.
///
/// With several slots the pager moves between slots and the filmstrip picks a
/// take within the current one. With a lone slot the pager moves between its
/// takes instead, so a swipe always goes somewhere.
@Observable
final class LightboxModel {
    private(set) var slots: [LightboxSlot]
    /// The page the pager is on; a slot id when paging slots, a take id when paging takes.
    var pageID: String?
    private var shownTakeIDs: [String: String] = [:]

    init(slots: [LightboxSlot], startingAt slotID: String?) {
        self.slots = slots
        let start = slots.first { $0.id == slotID } ?? slots.first
        pageID = slots.count == 1 ? start?.activeTake?.id : start?.id
    }

    var pagesTakes: Bool { slots.count == 1 }

    var pages: [LightboxPage] {
        if pagesTakes, let slot = slots.first {
            return slot.takes.map { LightboxPage(id: $0.id, slot: slot, take: $0) }
        }
        return slots.compactMap { slot in
            shownTake(in: slot).map { LightboxPage(id: slot.id, slot: slot, take: $0) }
        }
    }

    var currentPage: LightboxPage? {
        pages.first { $0.id == pageID }
    }

    /// Where the current page sits in the pager, counting from zero.
    var position: (index: Int, count: Int)? {
        let all = pages
        guard let index = all.firstIndex(where: { $0.id == pageID }) else { return nil }
        return (index, all.count)
    }

    /// Moves the pager by whole pages, stopping at either end. For VoiceOver,
    /// which cannot swipe the pager.
    func step(_ offset: Int) {
        let all = pages
        guard let index = all.firstIndex(where: { $0.id == pageID }) else { return }
        let target = index + offset
        if all.indices.contains(target) { pageID = all[target].id }
    }

    /// Previews a take of the current slot without changing which one the story uses.
    func show(_ take: ImageTake) {
        guard let slot = currentPage?.slot else { return }
        if pagesTakes {
            pageID = take.id
        } else {
            shownTakeIDs[slot.id] = take.id
        }
    }

    /// Takes in fresh data, keeping the reader where they were when it still exists.
    func update(slots newSlots: [LightboxSlot]) {
        guard newSlots != slots else { return }
        let before = currentPage
        let beforeIndex = position?.index
        slots = newSlots
        let takeIDs = Set(newSlots.flatMap { $0.takes.map(\.id) })
        shownTakeIDs = shownTakeIDs.filter { takeIDs.contains($0.value) }

        let now = pages
        if now.contains(where: { $0.id == pageID }) { return }
        if let slotID = before?.slot.id, let page = now.first(where: { $0.slot.id == slotID }) {
            pageID = page.id
        } else {
            pageID = now.isEmpty ? nil : now[min(beforeIndex ?? 0, now.count - 1)].id
        }
    }

    private func shownTake(in slot: LightboxSlot) -> ImageTake? {
        slot.takes.first { $0.id == shownTakeIDs[slot.id] } ?? slot.activeTake
    }
}
