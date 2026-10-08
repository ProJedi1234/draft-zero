import Foundation
import Testing
@testable import Draft_Zero

/// Whose composer text wins, after tests/composer-draft.test.ts: our own
/// echo, stale versions and events racing an unacknowledged edit are turned
/// away; everything else is adopted.
struct ComposerModelTests {
    private let selfOrigin = "this-device"
    private let v1 = "2026-09-01T00:00:01.000Z"
    private let v2 = "2026-09-01T00:00:02.000Z"

    private func model(seed: ComposerDraft? = nil) -> ComposerModel {
        // An unroutable address: nothing here should reach the network before it is asserted.
        let api = APIClient(baseURL: URL(string: "http://127.0.0.1:9")!, origin: selfOrigin)
        return ComposerModel(storyId: "s1", api: api, notices: NoticeCenter(), seed: seed)
    }

    private func draft(_ text: String, version: String, mode: ComposerMode = .do) -> ComposerDraft {
        ComposerDraft(text: text, mode: mode, imagePrompt: nil, imageAssisted: true, imageStyle: nil,
                      imageExcludedLoreIds: [], updatedAt: version)
    }

    private func event(
        _ text: String,
        version: String,
        storyId: String = "s1",
        origin: String = "other-device",
        mode: ComposerMode = .do,
        excluded: [String] = []
    ) throws -> SyncWireEvent.Draft {
        let json: [String: Any] = [
            "storyId": storyId, "text": text, "mode": mode.rawValue, "imagePrompt": NSNull(),
            "imageAssisted": true, "imageStyle": NSNull(), "imageExcludedLoreIds": excluded,
            "version": version, "origin": origin,
        ]
        return try JSONDecoder().decode(SyncWireEvent.Draft.self, from: JSONSerialization.data(withJSONObject: json))
    }

    @Test func adoptsAForeignDraftForThisStory() throws {
        let composer = model(seed: draft("old", version: v1))
        composer.adopt(try event("new", version: v2), selfOrigin: selfOrigin)
        #expect(composer.text == "new")
    }

    @Test func ignoresAnotherStorysDraft() throws {
        let composer = model(seed: draft("old", version: v1))
        composer.adopt(try event("new", version: v2, storyId: "s2"), selfOrigin: selfOrigin)
        #expect(composer.text == "old")
    }

    @Test func ignoresItsOwnEcho() throws {
        let composer = model(seed: draft("old", version: v1))
        composer.adopt(try event("new", version: v2, origin: selfOrigin), selfOrigin: selfOrigin)
        #expect(composer.text == "old")
    }

    @Test func aLocalEditInFlightOutranksTheWire() throws {
        let composer = model(seed: draft("old", version: v1))
        composer.text = "typing"
        composer.adopt(try event("new", version: v2), selfOrigin: selfOrigin)
        #expect(composer.text == "typing")
    }

    @Test func turnsAwayAnEventNoNewerThanTheDisplay() throws {
        let composer = model(seed: draft("old", version: v2))
        composer.adopt(try event("stale", version: v1), selfOrigin: selfOrigin)
        composer.adopt(try event("same", version: v2), selfOrigin: selfOrigin)
        #expect(composer.text == "old")
    }

    @Test func adoptsAClearAndABareModeSwap() throws {
        let composer = model(seed: draft("I draw my blade", version: v1))
        composer.adopt(try event("", version: v2, mode: .say), selfOrigin: selfOrigin)
        #expect(composer.text.isEmpty)
        #expect(composer.mode == .say)
    }

    @Test func adoptsAMuteMadeOnAnotherDevice() throws {
        let composer = model(seed: draft("Wren", version: v1, mode: .image))
        composer.adopt(try event("Wren", version: v2, mode: .image, excluded: ["lore-1"]), selfOrigin: selfOrigin)
        #expect(composer.excludedLoreIds == ["lore-1"])
    }

    @Test func readsTakeNewerRowsAndIgnoreStaleOnes() {
        let composer = model(seed: draft("one", version: v1))
        composer.reconcile(draft("two", version: v2))
        #expect(composer.text == "two")
        composer.reconcile(draft("older", version: v1))
        #expect(composer.text == "two")
    }

    @Test func noRowClearsOnlyAComposerThatNeverSawOne() {
        let fresh = model()
        fresh.reconcile(nil)
        #expect(fresh.text.isEmpty)

        let seen = model(seed: draft("kept", version: v1))
        seen.reconcile(nil)
        #expect(seen.text == "kept")
    }

    @Test func aLaneGoesStaleWhenTheBriefOrMutesChange() {
        let composer = model(seed: draft("Wren at the door", version: v1, mode: .image))
        composer.derivationSettled("A keeper at a weathered door, lantern in hand")
        composer.derivationEnded(brief: "Wren at the door", excludedLoreIds: [])
        #expect(composer.imageSendAction == .draw)

        composer.text = "Wren at the window"
        #expect(composer.laneStale)
        #expect(composer.imageSendAction == .develop)

        composer.text = "Wren at the door"
        #expect(!composer.laneStale)
        composer.toggleLore("lore-1")
        #expect(composer.laneStale)
    }

    @Test func verbatimAlwaysDraws() {
        let composer = model(seed: draft("A lighthouse", version: v1, mode: .image))
        composer.imageAssisted = false
        #expect(composer.imageSendAction == .draw)
    }

    @Test func restoringAPictureSplitsItsStyleAndArmsImage() {
        let composer = model()
        composer.restoreImagePrompt(
            prompt: "A keeper on the stair Style: oil painting, visible brushwork.",
            sourcePrompt: "Wren on the stairs"
        )
        #expect(composer.mode == .image)
        #expect(composer.text == "Wren on the stairs")
        #expect(composer.imagePrompt == "A keeper on the stair")
        #expect(composer.imageStyle == "oil painting, visible brushwork")
        #expect(composer.imageSendAction == .draw)
    }
}
