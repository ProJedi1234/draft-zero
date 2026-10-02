import Foundation
import Testing
@testable import Draft_Zero

private let v1 = "2026-09-01T00:00:01.000Z"
private let v2 = "2026-09-01T00:00:02.000Z"

/// An unroutable address: every request fails at once, as it would with no network.
private let offlineAPI = APIClient(baseURL: URL(string: "http://127.0.0.1:9")!, origin: "this-device")

private func story(_ id: String, version: String) -> StoryRecord {
    StoryRecord(
        id: id, title: id, description: "", genre: "", createdAt: v1, updatedAt: version,
        wordCount: 0, tintHue: nil, tintStrength: 0, tintAuto: false
    )
}

private func payload(_ text: String) -> DraftPayload {
    DraftPayload(text: text, mode: .do, imagePrompt: nil, imageAssisted: true, imageStyle: nil, imageExcludedLoreIds: [])
}

private func row(_ text: String, version: String) -> ComposerDraft {
    ComposerDraft(text: text, mode: .do, imagePrompt: nil, imageAssisted: true, imageStyle: nil,
                  imageExcludedLoreIds: [], updatedAt: version)
}

struct LocalStoreTests {
    private let server = URL(string: "http://hestia.lan:3000")!

    @Test func keepsTheLibraryAcrossLaunches() async throws {
        let file = FileManager.default.temporaryDirectory.appending(path: "\(UUID().uuidString).sqlite")
        defer { try? FileManager.default.removeItem(at: file) }

        let first = try LocalStore.open(at: file)
        first.saveStories([story("a", version: v1)])
        first.saveLibraryExtras(excerpts: ["a": "The lamp gutters."], railImages: [])
        _ = await first.library()

        let library = try #require(await LocalStore.open(at: file).library())
        #expect(library.stories.map(\.id) == ["a"])
        #expect(library.excerpts == ["a": "The lamp gutters."])
    }

    @Test func anOlderRowNeverReplacesANewerOne() async throws {
        let local = try LocalStore.inMemory()
        local.upsertStory(story("a", version: v2))
        local.upsertStory(story("a", version: v1))
        let library = try #require(await local.library())
        #expect(library.stories.map(\.updatedAt) == [v2])
    }

    @Test func bindingAnotherServerErasesWhatWasKept() async throws {
        let local = try LocalStore.inMemory()
        local.bind(to: server)
        local.saveStories([story("a", version: v1)])
        local.saveDraft("a", LocalDraft(payload: payload("mine"), version: v1, unsent: true))

        local.bind(to: server)
        #expect(await local.library() != nil)

        local.bind(to: URL(string: "http://elsewhere:3000")!)
        #expect(await local.library() == nil)
        #expect(await local.savedStory("a").draft == nil)
    }

    @Test func keepsTheWorkspaceResponseAsItCame() async throws {
        let local = try LocalStore.inMemory()
        let json = try FixtureLoader.data("workspace.json")
        local.saveWorkspace("s1", json: json)

        let kept = try #require(await local.savedStory("s1").workspace)
        #expect(kept == json)
        _ = try JSONDecoder().decode(WorkspacePayload.self, from: kept)
    }

    @Test func dropsTheLeastRecentlySavedWorkspacePastTheLimit() async throws {
        let local = try LocalStore.inMemory()
        let start = Date(timeIntervalSince1970: 1_000)
        for index in 0...LocalStore.workspaceLimit {
            local.saveWorkspace("s\(index)", json: Data("{}".utf8), savedAt: start.addingTimeInterval(Double(index)))
        }
        #expect(await local.savedStory("s0").workspace == nil)
        #expect(await local.savedStory("s1").workspace != nil)
        #expect(await local.savedStory("s\(LocalStore.workspaceLimit)").workspace != nil)
    }

    @Test func forgettingAStoryTakesItsWorkspaceAndDraft() async throws {
        let local = try LocalStore.inMemory()
        local.saveStories([story("a", version: v1), story("b", version: v1)])
        local.saveWorkspace("a", json: Data("{}".utf8))
        local.saveDraft("a", LocalDraft(payload: payload("mine"), version: v1, unsent: true))

        local.deleteStory("a")
        let saved = await local.savedStory("a")
        #expect(saved.workspace == nil)
        #expect(saved.draft == nil)
        #expect(try #require(await local.library()).stories.map(\.id) == ["b"])
    }

    @Test func aFullListForgetsWhatIsNoLongerOnIt() async throws {
        let local = try LocalStore.inMemory()
        local.saveStories([story("a", version: v1), story("b", version: v1)])
        local.saveWorkspace("a", json: Data("{}".utf8))
        local.saveDraft("a", LocalDraft(payload: payload("mine"), version: v1, unsent: false))

        local.saveStories([story("b", version: v1)])
        let saved = await local.savedStory("a")
        #expect(saved.workspace == nil)
        #expect(saved.draft == nil)
    }
}

/// Whose words the composer shows when a draft kept on the device meets the server's row.
struct ComposerLocalDraftTests {
    private func model(_ local: LocalStore) -> ComposerModel {
        ComposerModel(storyId: "s1", api: offlineAPI, notices: NoticeCenter(), seed: nil, local: local)
    }

    private func saved(_ text: String, version: String?, unsent: Bool) -> LocalDraft {
        LocalDraft(payload: payload(text), version: version, unsent: unsent)
    }

    @Test func wordsTypedOfflineAreKeptAsUnsent() async throws {
        let local = try LocalStore.inMemory()
        let composer = model(local)
        composer.text = "I light the lamp"
        composer.flush()

        let kept = try #require(await local.savedStory("s1").draft)
        #expect(kept.payload.text == "I light the lamp")
        #expect(kept.unsent)
    }

    @Test func anUnsentDraftOutlivesTheRowItWasTypedOn() throws {
        let composer = model(try LocalStore.inMemory())
        composer.restore(saved("mine", version: v1, unsent: true))
        composer.reconcile(row("theirs", version: v1))
        #expect(composer.text == "mine")
        #expect(composer.unsent)
    }

    @Test func aNewerServerRowBeatsAnUnsentDraft() async throws {
        let local = try LocalStore.inMemory()
        let composer = model(local)
        composer.restore(saved("mine", version: v1, unsent: true))
        composer.reconcile(row("newer", version: v2))
        #expect(composer.text == "newer")
        #expect(!composer.unsent)
        #expect(await local.savedStory("s1").draft == saved("newer", version: v2, unsent: false))
    }

    @Test func anUnsentDraftSurvivesAStoryWithNoRow() throws {
        let composer = model(try LocalStore.inMemory())
        composer.restore(saved("first words", version: nil, unsent: true))
        composer.reconcile(nil)
        #expect(composer.text == "first words")
    }

    @Test func aSentDraftNewerThanASavedPayloadStands() throws {
        let composer = model(try LocalStore.inMemory())
        composer.restore(saved("sent", version: v2, unsent: false))
        composer.reconcile(row("older", version: v1))
        #expect(composer.text == "sent")
    }

    @Test func restoringNeverOverwritesARowAlreadyShown() throws {
        let composer = model(try LocalStore.inMemory())
        composer.reconcile(row("server", version: v1))
        composer.restore(saved("stale", version: nil, unsent: true))
        #expect(composer.text == "server")
    }
}

struct LibraryRestoreTests {
    @Test func showsTheKeptLibraryWithoutClaimingTheServer() async throws {
        let local = try LocalStore.inMemory()
        local.saveStories([story("a", version: v1), story("b", version: v2)])
        let library = LibraryStore()
        library.attach(api: offlineAPI, local: local)

        await library.restore()
        #expect(library.isLoaded)
        #expect(!library.isLive)
        #expect(library.stories.map(\.id) == ["b", "a"])
        #expect(library.activeRuns.isEmpty)
    }

    @Test func aFailedLoadLeavesTheKeptLibraryUp() async throws {
        let local = try LocalStore.inMemory()
        local.saveStories([story("a", version: v1)])
        let library = LibraryStore()
        library.attach(api: offlineAPI, local: local)

        await library.restore()
        await library.load()
        #expect(library.loadError != nil)
        #expect(library.isLoaded)
        #expect(library.stories.map(\.id) == ["a"])
    }
}
