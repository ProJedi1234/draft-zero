import Foundation
import Observation

/// The library: every story's record, each one's latest prose, the newest
/// pictures, and which stories have a run in flight.
///
/// Stories come from the store snapshot, full on first load and as deltas
/// after that, and entity events on the sync channel fold single rows in
/// between. Rows are arbitrated last-writer-wins on `updatedAt`, the version
/// the server mints. The library this device kept fills the screen until the
/// first read lands, which is always a full one, as on the web.
@Observable
final class LibraryStore {
    /// How a story's latest run ended, marked only for stories nobody had open.
    enum RunMark: Equatable {
        case working
        case done
        case failed
    }

    private(set) var stories: [StoryRecord] = []
    private(set) var excerpts: [String: String] = [:]
    private(set) var railImages: [GalleryImage] = []
    private(set) var activeRuns: [ActiveRun] = []
    /// Endings that landed while their story was not open.
    private(set) var endings: [String: RunEndStatus] = [:]
    /// There is a library to show, from the server or from this device.
    private(set) var isLoaded = false
    /// The server has answered a library read since this server was chosen.
    private(set) var isLive = false
    private(set) var loadError: APIError?

    /// The story currently on screen; its endings are not news.
    @ObservationIgnored var openStoryId: String?

    @ObservationIgnored private var api: APIClient?
    @ObservationIgnored private var local: LocalStore?
    @ObservationIgnored private var snapshotTime: String?
    @ObservationIgnored private var refreshTask: Task<Void, Never>?
    @ObservationIgnored private var refreshRequested = false
    @ObservationIgnored private var activeRunObservers: [UUID: ([ActiveRun]) -> Void] = [:]

    func attach(api: APIClient, local: LocalStore?) {
        self.api = api
        self.local = local
        stories = []
        excerpts = [:]
        railImages = []
        activeRuns = []
        endings = [:]
        snapshotTime = nil
        isLoaded = false
        isLive = false
        loadError = nil
    }

    func story(_ id: String) -> StoryRecord? {
        stories.first { $0.id == id }
    }

    func runMark(for storyId: String) -> RunMark? {
        if activeRuns.contains(where: { $0.storyId == storyId }) { return .working }
        switch endings[storyId] {
        case .ok?: return .done
        case .error?: return .failed
        default: return nil
        }
    }

    func activeRun(for storyId: String) -> ActiveRun? {
        activeRuns.first { $0.storyId == storyId }
    }

    /// Forget a story's ending once the writer has seen it.
    func clearEnding(_ storyId: String) {
        endings[storyId] = nil
    }

    /// Called with the server's list of live runs every time it is refreshed.
    func observeActiveRuns(_ handler: @escaping ([ActiveRun]) -> Void) -> SyncSubscription {
        let id = UUID()
        activeRunObservers[id] = handler
        return SyncSubscription { [weak self] in self?.activeRunObservers[id] = nil }
    }

    // MARK: - Loading

    /// Shows the library this device kept, unless the server's has already arrived.
    /// Runs are left empty: a kept run is one that has long since ended.
    func restore() async {
        guard let saved = await local?.library(), !isLive else { return }
        stories = saved.stories.sorted(by: Self.newestFirst)
        excerpts = saved.excerpts
        railImages = saved.railImages
        isLoaded = true
    }

    /// Full load: every story, then the excerpts and rail.
    func load() async {
        guard let api else { return }
        do {
            let snapshot = try await api.storySnapshot()
            stories = snapshot.records.sorted(by: Self.newestFirst)
            snapshotTime = snapshot.serverTime
            loadError = nil
            isLoaded = true
            isLive = true
            local?.saveStories(stories)
            try await loadLibraryPayload(api)
        } catch is CancellationError {
            return
        } catch let error as APIError {
            loadError = error
        } catch {
            loadError = .transport(error.localizedDescription)
        }
    }

    /// Coalesces bursts of changes into one delta read.
    func scheduleRefresh() {
        refreshRequested = true
        guard refreshTask == nil else { return }
        refreshTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(250))
            while let self, self.refreshRequested {
                self.refreshRequested = false
                await self.refreshNow()
            }
            self?.refreshTask = nil
        }
    }

    /// A delta read of the stories that moved, plus the excerpts and runs.
    func refreshNow() async {
        guard let api else { return }
        guard let since = snapshotTime else {
            await load()
            return
        }
        do {
            let snapshot = try await api.storySnapshot(since: since)
            for record in snapshot.records { fold(record) }
            if let allIds = snapshot.allIds {
                let live = Set(allIds.map(\.id))
                stories.removeAll { !live.contains($0.id) }
            }
            snapshotTime = snapshot.serverTime
            loadError = nil
            isLoaded = true
            isLive = true
            local?.saveStories(stories)
            try await loadLibraryPayload(api)
        } catch is CancellationError {
            return
        } catch {
            // The next change event or foreground retries; the list on screen stays.
        }
    }

    private func loadLibraryPayload(_ api: APIClient) async throws {
        let payload = try await api.library()
        excerpts = payload.excerpts
        railImages = payload.railImages
        setActiveRuns(payload.activeRuns)
        local?.saveLibraryExtras(excerpts: payload.excerpts, railImages: payload.railImages)
    }

    // MARK: - Sync

    func handle(_ event: SyncWireEvent) {
        switch event {
        case .change:
            scheduleRefresh()
        case .entity(let entity) where entity.entity == "story":
            if entity.op == "delete" {
                remove(entity.id)
            } else if case .story(let record) = entity.payload {
                upsert(record)
            } else {
                scheduleRefresh()
            }
        case .runStarted(let storyId, let runId), .imageRunStarted(let storyId, let runId):
            guard !activeRuns.contains(where: { $0.runId == runId }) else { return }
            var runs = activeRuns
            runs.append(ActiveRun(storyId: storyId, runId: runId, startedAt: Date.now.ISO8601Format()))
            endings[storyId] = nil
            setActiveRuns(runs)
        case .runEnded(let storyId, let runId, let status):
            setActiveRuns(activeRuns.filter { $0.runId != runId })
            if storyId != openStoryId, status != .aborted {
                endings[storyId] = status
            }
            scheduleRefresh()
        default:
            break
        }
    }

    private func setActiveRuns(_ runs: [ActiveRun]) {
        activeRuns = runs
        for observer in activeRunObservers.values { observer(runs) }
    }

    // MARK: - Local writes

    func useTake(_ take: ImageTake, in slot: LightboxSlot) async throws {
        guard let api, let storyId = slot.storyId else { throw APIError.notConfigured }
        try await api.selectImage(storyId: storyId, imageGroupId: slot.id, imageId: take.id)
        if let index = railImages.firstIndex(where: { $0.imageGroupId == slot.id }),
           let updated = railImages[index].selecting(take) {
            railImages[index] = updated
            local?.saveLibraryExtras(excerpts: excerpts, railImages: railImages)
        }
        scheduleRefresh()
    }

    /// Folds a row in if it is at least as new as the one held, and keeps it on the device.
    func upsert(_ record: StoryRecord) {
        if fold(record) { local?.upsertStory(record) }
    }

    @discardableResult
    private func fold(_ record: StoryRecord) -> Bool {
        if let index = stories.firstIndex(where: { $0.id == record.id }) {
            guard record.updatedAt >= stories[index].updatedAt else { return false }
            stories[index] = record
        } else {
            stories.append(record)
        }
        stories.sort(by: Self.newestFirst)
        return true
    }

    func remove(_ storyId: String) {
        stories.removeAll { $0.id == storyId }
        excerpts[storyId] = nil
        endings[storyId] = nil
        railImages.removeAll { $0.storyId == storyId }
        local?.deleteStory(storyId)
    }

    /// Creates a story with a client-minted id, so it can open before the reply.
    func createStory(title: String? = nil) async throws -> String {
        guard let api else { throw APIError.notConfigured }
        let created = try await api.createStory(id: RandomID.make(), title: title)
        upsert(created.record)
        return created.id
    }

    func duplicateStory(_ storyId: String) async throws -> String {
        guard let api else { throw APIError.notConfigured }
        let created = try await api.duplicateStory(storyId, copyId: RandomID.make())
        upsert(created.record)
        scheduleRefresh()
        return created.id
    }

    func deleteStory(_ storyId: String) async throws {
        guard let api else { throw APIError.notConfigured }
        let removed = story(storyId)
        remove(storyId)
        do {
            try await api.deleteStory(storyId)
        } catch {
            if let removed { upsert(removed) }
            throw error
        }
    }

    func renameStory(_ storyId: String, title: String) async throws {
        guard let api else { throw APIError.notConfigured }
        let record = try await api.updateStoryMeta(storyId, patch: ["title": .string(title)])
        upsert(record)
    }

    nonisolated private static func newestFirst(_ a: StoryRecord, _ b: StoryRecord) -> Bool {
        a.updatedAt == b.updatedAt ? a.id < b.id : a.updatedAt > b.updatedAt
    }
}
