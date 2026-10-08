import CoreGraphics
import SwiftUI
import Testing
@testable import Draft_Zero

struct LightboxModelTests {
    private func take(_ id: String) -> ImageTake {
        ImageTake(id: id, prompt: id, aspectRatio: .landscape, mediaType: "image/png", modelId: "m/x", seed: 1, createdAt: "2026-09-01T00:00:00.000Z")
    }

    private func slot(_ id: String, takes: [String], active: String? = nil) -> LightboxSlot {
        LightboxSlot(id: id, takes: takes.map(take), activeTakeId: active ?? takes[0], storyId: "story", storyTitle: "Story")
    }

    @Test func severalSlotsPageBySlotShowingTheActiveTake() {
        let model = LightboxModel(slots: [slot("a", takes: ["a1", "a2"], active: "a2"), slot("b", takes: ["b1"])], startingAt: "b")
        #expect(model.pagesTakes == false)
        #expect(model.pages.map(\.id) == ["a", "b"])
        #expect(model.pages.map(\.take.id) == ["a2", "b1"])
        #expect(model.currentPage?.slot.id == "b")
        #expect(model.position?.index == 1)
        #expect(model.position?.count == 2)
    }

    @Test func aLoneSlotPagesItsTakes() {
        let model = LightboxModel(slots: [slot("a", takes: ["a1", "a2", "a3"], active: "a2")], startingAt: "a")
        #expect(model.pagesTakes)
        #expect(model.pages.map(\.id) == ["a1", "a2", "a3"])
        #expect(model.currentPage?.take.id == "a2")
    }

    @Test func showingATakePreviewsItWithoutMovingSlots() throws {
        let a = slot("a", takes: ["a1", "a2"])
        let model = LightboxModel(slots: [a, slot("b", takes: ["b1"])], startingAt: "a")
        model.show(a.takes[1])
        #expect(model.currentPage?.slot.id == "a")
        #expect(model.currentPage?.take.id == "a2")
        #expect(model.currentPage?.slot.activeTakeId == "a1")
    }

    @Test func showingATakeInALoneSlotMovesThePager() {
        let a = slot("a", takes: ["a1", "a2"])
        let model = LightboxModel(slots: [a], startingAt: "a")
        model.show(a.takes[1])
        #expect(model.pageID == "a2")
    }

    @Test func unknownStartFallsBackToTheFirstSlot() {
        let model = LightboxModel(slots: [slot("a", takes: ["a1"]), slot("b", takes: ["b1"])], startingAt: "gone")
        #expect(model.pageID == "a")
    }

    @Test func updateKeepsTheReaderWhereTheyWere() {
        let a = slot("a", takes: ["a1", "a2"])
        let b = slot("b", takes: ["b1"])
        let model = LightboxModel(slots: [a, b], startingAt: "b")
        model.update(slots: [slot("c", takes: ["c1"]), a, b])
        #expect(model.pageID == "b")
    }

    @Test func updateMovesOffASlotThatVanished() {
        let model = LightboxModel(slots: [slot("a", takes: ["a1"]), slot("b", takes: ["b1"]), slot("c", takes: ["c1"])], startingAt: "b")
        model.update(slots: [slot("a", takes: ["a1"]), slot("c", takes: ["c1"])])
        #expect(model.pageID == "c")
    }

    @Test func updateForgetsAPreviewOfADeletedTake() {
        let a = slot("a", takes: ["a1", "a2"])
        let model = LightboxModel(slots: [a, slot("b", takes: ["b1"])], startingAt: "a")
        model.show(a.takes[1])
        model.update(slots: [slot("a", takes: ["a1"]), slot("b", takes: ["b1"])])
        #expect(model.currentPage?.take.id == "a1")
    }

    @Test func promotingATakeMovesTheActiveMark() {
        let a = slot("a", takes: ["a1", "a2"])
        let model = LightboxModel(slots: [a, slot("b", takes: ["b1"])], startingAt: "a")
        model.show(a.takes[1])
        model.update(slots: [slot("a", takes: ["a1", "a2"], active: "a2"), slot("b", takes: ["b1"])])
        #expect(model.currentPage?.slot.activeTake?.id == "a2")
        #expect(model.currentPage?.take.id == "a2")
    }

    @Test func emptyDataLeavesNoPages() {
        let model = LightboxModel(slots: [slot("a", takes: ["a1"])], startingAt: "a")
        model.update(slots: [])
        #expect(model.pages.isEmpty)
        #expect(model.pageID == nil)
    }
}

struct ZoomGeometryTests {
    private func geometry(ratio: Double = 16.0 / 9, insets: EdgeInsets = EdgeInsets()) -> ZoomGeometry {
        ZoomGeometry(viewport: CGSize(width: 400, height: 800), insets: insets, aspectRatio: ratio)
    }

    @Test func fitsTheLimitingAxis() {
        #expect(geometry(ratio: 16.0 / 9).fittedSize == CGSize(width: 400, height: 225))
        #expect(abs(geometry(ratio: 9.0 / 16).fittedSize.height - 711.111) < 0.01)
        #expect(geometry(ratio: 1).fittedSize == CGSize(width: 400, height: 400))
    }

    @Test func insetsShrinkTheFitAndShiftTheResting() {
        let g = geometry(ratio: 9.0 / 16, insets: EdgeInsets(top: 100, leading: 0, bottom: 300, trailing: 0))
        #expect(g.fittedSize.height == 400)
        #expect(g.restingOffset == CGSize(width: 0, height: -100))
    }

    @Test func scaleStaysInRange() {
        let g = geometry()
        #expect(g.clampedScale(0.4) == 1)
        #expect(g.clampedScale(2) == 2)
        #expect(g.clampedScale(50) == ZoomGeometry.maxScale)
    }

    @Test func panIsPinnedWhileThePictureFitsTheViewport() {
        let g = geometry()
        #expect(g.clampedPan(CGSize(width: 90, height: 90), scale: 1) == .zero)
        #expect(g.clampedPan(CGSize(width: 90, height: 90), scale: 1.5).width == 90)
        #expect(g.clampedPan(CGSize(width: 90, height: 90), scale: 1.5).height == 0)
    }

    @Test func panStopsAtTheEdgesOfTheZoomedPicture() {
        let g = geometry(ratio: 1)
        let far = g.clampedPan(CGSize(width: 9999, height: 9999), scale: 4)
        #expect(far.width == 600)
        #expect(far.height == 400)
        let near = g.clampedPan(CGSize(width: -9999, height: -9999), scale: 4)
        #expect(near.width == -600)
        #expect(near.height == -400)
    }

    @Test func zoomingKeepsTheAnchoredPointStill() {
        let g = geometry(ratio: 1)
        let anchor = CGPoint(x: 120, y: -50)
        let pan = g.pan(from: .zero, scale: 1, to: 3, about: anchor)
        // The point under the anchor sits at anchor * scale + pan; it must not have moved.
        #expect(abs(anchor.x * 3 + pan.width - anchor.x) < 0.001)
        #expect(abs(anchor.y * 3 + pan.height - anchor.y) < 0.001)
    }

    @Test func zoomingAboutTheCentreNeverPans() {
        let g = geometry()
        #expect(g.pan(from: .zero, scale: 1, to: 2.5, about: .zero) == .zero)
    }
}

struct LightboxSteppingTests {
    private func slot(_ id: String) -> LightboxSlot {
        LightboxSlot(id: id, takes: [ImageTake(id: "\(id)1", prompt: id, aspectRatio: .square, mediaType: "image/png", modelId: "m/x", seed: 1, createdAt: "")], activeTakeId: "\(id)1", storyId: nil, storyTitle: nil)
    }

    @Test func steppingStopsAtBothEnds() {
        let model = LightboxModel(slots: [slot("a"), slot("b"), slot("c")], startingAt: "a")
        model.step(-1)
        #expect(model.pageID == "a")
        model.step(1)
        model.step(1)
        model.step(1)
        #expect(model.pageID == "c")
        model.step(-1)
        #expect(model.pageID == "b")
    }
}
