import Foundation
import Observation

/// Everything one open story needs: its payload, its three live runs, its
/// composer, and the sync wiring that keeps them current across devices.
///
/// The server is the authority. Every change event for this story, and every
/// write this device makes, ends in a fresh read of the workspace payload;
/// what the controllers show ahead of the server is derived from that data.
@Observable
final class StoryWorkspace {
    enum LoadState: Equatable {
        case loading
        case loaded
        case notFound
        case failed(String)
    }

    let storyId: String
    let api: APIClient
    let notices: NoticeCenter
    let generation: GenerationController
    let illustration: IllustrationController
    let derivation: DerivationController
    let composer: ComposerModel

    private(set) var loadState: LoadState = .loading
    private(set) var story: Story?
    private(set) var lorebook: [LorebookEntry] = []
    private(set) var models: [OpenRouterModel] = []
    private(set) var imageModels: [OpenRouterImageModel] = []
    /// What the story's image model costs per picture, when known.
    private(set) var imageModelPrice: String?
    /// What a nil story image model resolves to.
    private(set) var defaultImageModelId = ""
    private(set) var costProfile: StoryCostProfile?
    private(set) var profiles: [ModelProfile] = []
    private(set) var defaultProfileId: String?
    private(set) var requireZdr = false

    /// Pages of passages older than the payload's tail window, oldest first.
    private(set) var olderEntries: [StoryEntry] = []
    private(set) var hasMoreOlder = false
    private(set) var isLoadingOlder = false

    /// Where the atmosphere picker is on this story, for the indicator.
    private(set) var atmosphere: SyncWireEvent.Atmosphere?

    @ObservationIgnored let library: LibraryStore
    @ObservationIgnored private let sync: SyncChannel
    @ObservationIgnored private var subscriptions: [SyncSubscription] = []
    @ObservationIgnored private var refreshTask: Task<Void, Never>?
    @ObservationIgnored private var refreshAgain = false
    @ObservationIgnored private var scheduledRefresh: Task<Void, Never>?
    @ObservationIgnored private var atmosphereShownAt: ContinuousClock.Instant?
    @ObservationIgnored private var atmosphereHold: Task<Void, Never>?
    @ObservationIgnored private var lastUpdatedAt: String?
    @ObservationIgnored private var started = false

    init(storyId: String, app: AppModel, api: APIClient) {
        self.storyId = storyId
        self.api = api
        notices = app.notices
        library = app.library
        sync = app.sync
        generation = GenerationController(storyId: storyId, api: api, notices: app.notices)
        illustration = IllustrationController(storyId: storyId, api: api, notices: app.notices)
        derivation = DerivationController(storyId: storyId, api: api, notices: app.notices)
        composer = ComposerModel(storyId: storyId, api: api, notices: app.notices, seed: nil)
        generation.workspace = self
        illustration.workspace = self
        derivation.composer = composer
        composer.derivation = derivation
    }

    // MARK: - Lifecycle

    /// Subscribes, loads, and attaches to anything already running.
    func start() {
        guard !started else { return }
        started = true
        library.openStoryId = storyId
        library.clearEnding(storyId)

        subscriptions = [
            sync.subscribe { [weak self] event in self?.handle(event) },
            sync.onReconnect { [weak self] in self?.reconnected() },
            library.observeActiveRuns { [weak self] runs in self?.generation.reconcile(liveRuns: runs) },
        ]

        // A device that merely opens the story while a run is live adopts it.
        generation.attach(nil)
        illustration.attach(nil)
        derivation.attach(nil)
        generation.reconcile(liveRuns: library.activeRuns)

        Task { await refreshNow() }
    }

    /// Detaches listeners and flushes the draft. Server runs keep going.
    func stop() {
        guard started else { return }
        started = false
        composer.flush()
        for subscription in subscriptions { subscription.release() }
        subscriptions = []
        generation.detach()
        illustration.detach()
        derivation.detach()
        scheduledRefresh?.cancel()
        atmosphereHold?.cancel()
        if library.openStoryId == storyId { library.openStoryId = nil }
    }

    /// Foreground: sockets may have died silently while backgrounded.
    func wake() {
        guard started else { return }
        generation.wake()
        illustration.attach(nil)
        derivation.attach(nil)
        composer.resync()
        scheduleRefresh()
    }

    func willBackground() {
        composer.flush()
    }

    // MARK: - Reading

    /// Reads the workspace payload; concurrent calls coalesce into one trailing read.
    func refreshNow() async {
        if let running = refreshTask {
            refreshAgain = true
            await running.value
            return
        }
        let task = Task {
            repeat {
                refreshAgain = false
                await load()
            } while refreshAgain
        }
        refreshTask = task
        await task.value
        refreshTask = nil
    }

    /// Coalesces a burst of change events into one read.
    func scheduleRefresh() {
        scheduledRefresh?.cancel()
        scheduledRefresh = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(150))
            guard !Task.isCancelled else { return }
            await self?.refreshNow()
        }
    }

    private func load() async {
        do {
            let payload = try await api.workspace(storyId: storyId)
            await apply(payload)
        } catch is CancellationError {
            return
        } catch let error as APIError where error.isNotFound {
            loadState = .notFound
        } catch {
            if story == nil {
                loadState = .failed((error as? LocalizedError)?.errorDescription ?? "Couldn't open this story.")
            }
        }
    }

    private func apply(_ payload: WorkspacePayload) async {
        let previousUpdatedAt = lastUpdatedAt
        story = payload.story
        lorebook = payload.lorebookEntries
        models = payload.models
        imageModels = payload.imageModels
        imageModelPrice = payload.imageModelPrice
        defaultImageModelId = payload.defaultImageModelId
        costProfile = payload.costProfile
        profiles = payload.profiles
        defaultProfileId = payload.defaultProfileId
        requireZdr = payload.requireZdr
        loadState = .loaded
        lastUpdatedAt = payload.story.updatedAt

        reconcileOlderEntries(with: payload.story)
        composer.reconcile(payload.composerDraft)
        generation.workspaceDidRefresh()
        illustration.settle(images: payload.story.images)

        // Held older pages go stale when the story moves; re-read them in one call.
        if !olderEntries.isEmpty, previousUpdatedAt != nil, previousUpdatedAt != payload.story.updatedAt,
           let windowStart = payload.story.windowStartPosition {
            if let page = try? await api.olderEntries(storyId: storyId, beforePosition: windowStart, limit: olderEntries.count) {
                olderEntries = page.entries
                hasMoreOlder = page.hasMore
            }
        }
    }

    private func reconcileOlderEntries(with story: Story) {
        guard !olderEntries.isEmpty else {
            hasMoreOlder = story.hasMoreBefore ?? false
            return
        }
        let windowIds = Set(story.entries.map(\.id))
        let windowStart = story.windowStartPosition ?? Int.max
        olderEntries.removeAll { windowIds.contains($0.id) || ($0.position ?? 0) >= windowStart }
        if olderEntries.isEmpty { hasMoreOlder = story.hasMoreBefore ?? false }
    }

    /// Pages older passages in ahead of the loaded window.
    func loadOlder() async {
        guard hasMoreOlder, !isLoadingOlder, let story else { return }
        guard let cursor = olderEntries.first?.position ?? story.windowStartPosition else { return }
        isLoadingOlder = true
        defer { isLoadingOlder = false }
        do {
            let page = try await api.olderEntries(storyId: storyId, beforePosition: cursor)
            let held = Set(olderEntries.map(\.id))
            olderEntries = page.entries.filter { !held.contains($0.id) } + olderEntries
            hasMoreOlder = page.hasMore
        } catch is CancellationError {
        } catch {
            notices.error(error, fallback: "Couldn't load earlier passages.")
        }
    }

    // MARK: - The manuscript

    /// Every loaded live passage, oldest first.
    var loadedEntries: [StoryEntry] {
        olderEntries + (story?.entries ?? [])
    }

    var liveEntryIds: Set<String> {
        Set(loadedEntries.map(\.id))
    }

    /// Passages and pictures in manuscript order, minus what a retry is replacing.
    var manuscript: [ManuscriptItem] {
        guard let story else { return [] }
        let hidden = generation.hiddenEntryIds
        let entries = loadedEntries.filter { !hidden.contains($0.id) }
        // While older passages are still unloaded, pictures above the loaded
        // window would float at the top with nothing around them.
        let floor = hasMoreOlder ? (entries.first?.position ?? Int.min) : Int.min
        let items = entries.map(ManuscriptItem.entry)
            + story.images.filter { $0.position >= floor }.map(ManuscriptItem.image)
        return items.sorted { $0.position < $1.position }
    }

    var isEmpty: Bool {
        manuscript.isEmpty && generation.optimisticUserText == nil && !generation.showsTail && illustration.job == nil
    }

    /// The newest passage, which alone can switch takes and be retried.
    var lastEntryId: String? { story?.entries.last?.id }

    var tint: StoryTintValue {
        StoryTintValue(hue: story?.tintHue, strength: story?.tintStrength ?? 0)
    }

    var currentProfile: ModelProfile? {
        guard let id = story?.profileId else { return nil }
        return profiles.first { $0.id == id }
    }

    /// The image model plain Retry and Draw use.
    var effectiveImageModelId: String {
        story?.imageModelId ?? defaultImageModelId
    }

    func model(_ id: String) -> OpenRouterModel? {
        models.first { $0.id == id }
    }

    // MARK: - Composer

    /// The composer's primary action: send a move, develop a brief, or draw.
    func sendFromComposer() {
        guard !generation.busy else { return }
        if composer.mode == .image {
            guard !illustration.isBusy, !derivation.deriving else { return }
            switch composer.imageSendAction {
            case .draw:
                drawFromComposer()
            case .develop:
                guard composer.hasText else { return }
                developFromComposer()
            }
            return
        }
        guard composer.hasText, let kind = composer.mode.actionKind else { return }
        if generation.send(composer.text, kind: kind) {
            composer.text = ""
        }
    }

    /// Develops the brief into a full prompt. With an empty brief, describes the story as it stands.
    func developFromComposer() {
        guard composer.imageAssisted, !derivation.deriving, !illustration.isBusy else { return }
        // Our pending save goes first, or it could land after the develop's own write.
        composer.flush()
        derivation.develop(brief: composer.brief, excludedLoreIds: Array(composer.excludedLoreIds))
    }

    private func drawFromComposer() {
        let assisted = composer.imageAssisted
        let scene = assisted ? composer.lane : composer.brief
        guard !scene.isEmpty else { return }
        let request = IllustrationController.Request(
            prompt: ImageStyles.compose(scene: scene, style: composer.imageStyle),
            sourcePrompt: assisted && composer.hasText ? composer.brief : nil,
            promptLoreIds: assisted ? composer.includedLoreIds(in: lorebook) : [],
            aspectRatio: composer.aspectRatio
        )
        composer.clearAfterImageSend()
        illustration.generate(request)
    }

    /// Hands a failed move's words back to the composer.
    func restoreComposerText(_ text: String) {
        composer.text = text
    }

    /// Hands a failed draw's prompt back, only into an empty composer.
    func restoreImagePrompt(prompt: String, sourcePrompt: String?) {
        if composer.text.isEmpty {
            composer.restoreImagePrompt(prompt: prompt, sourcePrompt: sourcePrompt)
        } else {
            composer.mode = .image
        }
    }

    // MARK: - Sync

    private func handle(_ event: SyncWireEvent) {
        switch event {
        case .change(let changed):
            if changed == nil || changed == storyId { scheduleRefresh() }
        case .entity(let entity):
            if entity.storyId == storyId || entity.entity == "model-profile" || entity.entity == "app-settings" {
                scheduleRefresh()
            }
        case .runStarted(let story, let runId) where story == storyId:
            generation.attach(runId)
        case .imageRunStarted(let story, let runId) where story == storyId:
            illustration.attach(runId)
        case .deriveRunStarted(let story, let runId) where story == storyId:
            derivation.attach(runId)
        case .draft(let draft):
            composer.adopt(draft, selfOrigin: api.origin)
        case .atmosphere(let status) where status.storyId == storyId:
            showAtmosphere(status)
        case .summaryStopped(let story) where story == storyId:
            notices.error("Summarizing stopped after repeated failures. Older passages will fall out of context unsummarized.")
        default:
            break
        }
    }

    /// Events emitted while the socket was down are gone: re-probe every channel.
    private func reconnected() {
        generation.attach(nil)
        illustration.attach(nil)
        derivation.attach(nil)
        composer.resync()
        scheduleRefresh()
    }

    /// Holds "checking" on screen long enough to be read: a check against a
    /// fast model is over before the eye arrives.
    private func showAtmosphere(_ status: SyncWireEvent.Atmosphere) {
        atmosphereHold?.cancel()
        if status.phase == .checking {
            atmosphereShownAt = .now
            atmosphere = status
            return
        }
        let minimum: Duration = .milliseconds(1400)
        let elapsed = atmosphereShownAt.map { ContinuousClock.now - $0 } ?? minimum
        if elapsed >= minimum {
            atmosphere = status
            return
        }
        atmosphereHold = Task { [weak self] in
            try? await Task.sleep(for: minimum - elapsed)
            guard !Task.isCancelled else { return }
            self?.atmosphere = status
        }
    }
}
