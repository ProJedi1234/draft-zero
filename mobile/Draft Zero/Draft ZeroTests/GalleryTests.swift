import Foundation
import Testing
@testable import Draft_Zero

struct GalleryGroupingTests {
    private func take(_ id: String, ratio: ImageAspectRatio = .landscape) -> ImageTake {
        ImageTake(id: id, prompt: "prompt \(id)", aspectRatio: ratio, mediaType: "image/png", modelId: "m/x", seed: 1, createdAt: "2026-09-01T00:00:00.000Z")
    }

    private func image(_ id: String, story: String, title: String? = nil, hue: Double? = nil, takes: [String]? = nil, active: Int = 0) -> GalleryImage {
        let all = (takes ?? [id]).map { take($0) }
        return GalleryImage(
            id: all[active].id, prompt: "prompt", aspectRatio: .landscape, mediaType: "image/png", modelId: "m/x",
            createdAt: "2026-09-01T00:00:00.000Z", storyId: story, storyTitle: title ?? "Story \(story)",
            tintHue: hue, tintStrength: hue == nil ? 0 : 0.8, imageGroupId: all[0].id, imageIndex: active, takes: all
        )
    }

    @Test func sectionsFollowFirstAppearanceAndKeepOrder() {
        let images = [
            image("a1", story: "A"), image("b1", story: "B"), image("a2", story: "A"),
            image("c1", story: "C"), image("b2", story: "B"),
        ]
        let sections = GalleryGrouping.sections(images)
        #expect(sections.map(\.storyId) == ["A", "B", "C"])
        #expect(sections.map { $0.images.map(\.id) } == [["a1", "a2"], ["b1", "b2"], ["c1"]])
    }

    @Test func sectionTakesTitleAndTintFromItsFirstPicture() {
        let sections = GalleryGrouping.sections([image("a1", story: "A", title: "Ash", hue: 25), image("a2", story: "A", title: "Ash (old)", hue: 200)])
        #expect(sections.first?.title == "Ash")
        #expect(sections.first?.tint == StoryTintValue(hue: 25, strength: 0.8))
    }

    @Test func emptyWallHasNoSections() {
        #expect(GalleryGrouping.sections([]).isEmpty)
    }

    @Test func displayedOrderMatchesTheLayout() {
        let images = [image("a1", story: "A"), image("b1", story: "B"), image("a2", story: "A")]
        #expect(GalleryGrouping.displayed(images, by: .newest).map(\.id) == ["a1", "b1", "a2"])
        #expect(GalleryGrouping.displayed(images, by: .byStory).map(\.id) == ["a1", "a2", "b1"])
    }

    @Test func selectingATakeMakesTheRowMirrorIt() throws {
        let row = image("t1", story: "A", takes: ["t1", "t2", "t3"], active: 0)
        let updated = try #require(row.selecting(row.takes[2]))
        #expect(updated.id == "t3")
        #expect(updated.imageIndex == 2)
        #expect(updated.prompt == "prompt t3")
        #expect(updated.imageGroupId == row.imageGroupId)
        #expect(row.selecting(take("elsewhere")) == nil)
    }

    @Test func slotNamesItsActiveTake() {
        let row = image("t1", story: "A", takes: ["t1", "t2"], active: 1)
        #expect(row.lightboxSlot.activeTakeId == "t2")
        #expect(row.lightboxSlot.id == "t1")
        #expect(row.lightboxSlot.storyId == "A")
    }
}

struct JustifiedLayoutTests {
    private let mixed: [Double] = [16.0 / 9, 9.0 / 16, 1, 16.0 / 9, 1, 9.0 / 16, 9.0 / 16, 16.0 / 9, 1, 1, 16.0 / 9]

    @Test(arguments: [320.0, 402.0, 744.0, 1024.0])
    func everyPictureIsPlacedOnceInOrder(width: Double) {
        let rows = JustifiedLayout.rows(aspectRatios: mixed, width: width, targetHeight: 150, spacing: 2)
        #expect(rows.flatMap(\.items).map(\.index) == Array(mixed.indices))
    }

    @Test(arguments: [320.0, 402.0, 744.0, 1024.0])
    func fullRowsSpanTheWidthAndKeepEachAspectRatio(width: Double) {
        let rows = JustifiedLayout.rows(aspectRatios: mixed, width: width, targetHeight: 150, spacing: 2)
        for row in rows.dropLast() {
            let span = row.items.reduce(0) { $0 + $1.width } + 2 * Double(row.items.count - 1)
            #expect(abs(span - width) < 0.001)
        }
        for row in rows {
            for item in row.items {
                #expect(abs(item.width / row.height - mixed[item.index]) < 0.001)
            }
        }
    }

    @Test func lastRowKeepsTheTargetHeightInsteadOfStretching() throws {
        let rows = JustifiedLayout.rows(aspectRatios: [1, 1, 1], width: 400, targetHeight: 150, spacing: 2)
        let last = try #require(rows.last)
        #expect(last.height <= 150 + 0.001)
        let span = last.items.reduce(0) { $0 + $1.width }
        #expect(span <= 400)
    }

    @Test func aSinglePictureNeverOverflowsTheRow() throws {
        let rows = JustifiedLayout.rows(aspectRatios: [16.0 / 9], width: 200, targetHeight: 150, spacing: 2)
        let row = try #require(rows.first)
        #expect(row.items.count == 1)
        #expect(abs(row.items[0].width - 200) < 0.001)
        #expect(abs(row.height - 112.5) < 0.001)
    }

    @Test func degenerateInputsMakeNoRows() {
        #expect(JustifiedLayout.rows(aspectRatios: [1], width: 0, targetHeight: 150, spacing: 2).isEmpty)
        #expect(JustifiedLayout.rows(aspectRatios: [], width: 300, targetHeight: 150, spacing: 2).isEmpty)
    }
}

struct RefreshCoalescerTests {
    @Test func aBurstOfRequestsReloadsOnce() async throws {
        var reloads = 0
        let coalescer = RefreshCoalescer(delay: .milliseconds(20)) { reloads += 1 }
        for _ in 0..<10 { coalescer.request() }
        try await Task.sleep(for: .milliseconds(200))
        #expect(reloads == 1)
    }

    @Test func aRequestDuringAReloadEarnsOneMorePass() async throws {
        var reloads = 0
        var coalescer: RefreshCoalescer!
        coalescer = RefreshCoalescer(delay: .milliseconds(20)) {
            reloads += 1
            if reloads == 1 { coalescer.request() }
        }
        coalescer.request()
        try await Task.sleep(for: .milliseconds(300))
        #expect(reloads == 2)
    }
}

struct MissingPicturesTests {
    private func image(_ id: String) -> GalleryImage {
        let take = ImageTake(id: id, prompt: "prompt", aspectRatio: .landscape, mediaType: "image/png", modelId: "m/x", seed: 1, createdAt: "2026-09-01T00:00:00.000Z")
        return GalleryImage(
            id: id, prompt: "prompt", aspectRatio: .landscape, mediaType: "image/png", modelId: "m/x",
            createdAt: "2026-09-01T00:00:00.000Z", storyId: "A", storyTitle: "Story A",
            tintHue: nil, tintStrength: 0, imageGroupId: id, imageIndex: 0, takes: [take], missing: true
        )
    }

    @Test func missingFlagDecodes() throws {
        let take = #"{"id":"t","prompt":"p","aspectRatio":"16:9","mediaType":"image/png","modelId":"m/x","seed":1,"createdAt":"2026-09-01T00:00:00.000Z"}"#
        let json = #"{"id":"t","prompt":"p","aspectRatio":"16:9","mediaType":"image/png","modelId":"m/x","createdAt":"2026-09-01T00:00:00.000Z","storyId":"A","storyTitle":"A","tintHue":null,"tintStrength":0,"imageGroupId":"t","imageIndex":0,"takes":[\#(take)],"missing":true}"#
        let image = try JSONDecoder().decode(GalleryImage.self, from: Data(json.utf8))
        #expect(image.missing == true)
    }

    @Test func nothingDismissedAlerts() {
        #expect(MissingPicturesDismissal.shouldAlert(missing: [image("a")], dismissed: ""))
    }

    @Test func noMissingPicturesNeverAlerts() {
        #expect(!MissingPicturesDismissal.shouldAlert(missing: [], dismissed: ""))
    }

    @Test func dismissingSilencesTheSameSet() {
        let stored = MissingPicturesDismissal.encode(["a", "b"])
        #expect(!MissingPicturesDismissal.shouldAlert(missing: [image("a"), image("b")], dismissed: stored))
        #expect(!MissingPicturesDismissal.shouldAlert(missing: [image("a")], dismissed: stored))
    }

    @Test func aNewlyMissingPictureAlertsAgain() {
        let stored = MissingPicturesDismissal.encode(["a"])
        #expect(MissingPicturesDismissal.shouldAlert(missing: [image("a"), image("c")], dismissed: stored))
    }
}
