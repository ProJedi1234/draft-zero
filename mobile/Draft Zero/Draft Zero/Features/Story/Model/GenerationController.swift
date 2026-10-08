import Foundation
import Observation

/// Mirrors a story's server-owned generation run. A port of hooks/use-generation.ts.
///
/// The server persists the writer's turn, runs the model as a detached task and
/// persists the passage before it sends the terminal frame. This controller is
/// a subscriber: it shows where the run is and watches it move, exactly like
/// every other device on the story. Cancelling a subscription detaches a
/// listener and nothing else; `stop()` is the only thing that aborts a run.
///
/// What the manuscript shows ahead of the server (the echoed turn, the streamed
/// passage, the take a retry replaces) is held until the server's own row is
/// present in the workspace, and derived from that data rather than timed.
@Observable
final class GenerationController {
    enum Status: Equatable {
        case idle
        /// The request is in flight and nothing has come back.
        case pending
        /// The model is reasoning and has written no prose yet.
        case thinking
        case streaming
        /// The prose is final and the persisted row is on its way.
        case settling
    }

    /// The writer's turn, shown from the moment it is sent until its row lands.
    struct Echo: Equatable {
        var text: String
        /// Nil until the server acknowledges the turn.
        var entryId: String?
    }

    private(set) var status: Status = .idle
    private(set) var streamingText = ""
    /// Exact counts for the last completed generation, from its usage event.
    private(set) var usage: GenerationUsage?
    private(set) var echo: Echo?
    private(set) var tailEntryId: String?
    private(set) var removingEntryIds: [String] = []
    private(set) var isStarting = false
    private(set) var isMovingHistory = false

    @ObservationIgnored weak var workspace: StoryWorkspace?
    @ObservationIgnored private let storyId: String
    @ObservationIgnored private let api: APIClient
    @ObservationIgnored private let notices: NoticeCenter

    /// True from the moment this device owns or mirrors a run until it settles.
    @ObservationIgnored private var active = false
    @ObservationIgnored private var reader: Task<Void, Never>?
    @ObservationIgnored private var readerToken = 0
    @ObservationIgnored private var runId: String?
    /// A run-started that arrived while the slot was held; chased on release.
    @ObservationIgnored private var pendingAttach: String?
    /// This device's own start token, so a bare Stop only reaches its own run.
    @ObservationIgnored private var startTurnId: String?
    @ObservationIgnored private var stopDuringStart = false
    /// A persisted turn exists that the workspace has not been handed yet.
    @ObservationIgnored private var refreshOwed = false
    /// Composer text cleared on dispatch that only this controller can give back.
    @ObservationIgnored private var unownedText: String?
    @ObservationIgnored private var settleTimer: Task<Void, Never>?
    @ObservationIgnored private var costRefresh: Task<Void, Never>?

    init(storyId: String, api: APIClient, notices: NoticeCenter) {
        self.storyId = storyId
        self.api = api
        self.notices = notices
    }

    // MARK: - Derived state

    private var entryIds: Set<String> { workspace?.liveEntryIds ?? [] }

    var busy: Bool { isStarting || isMovingHistory || status != .idle }

    /// In-flight prose, then the finished passage until its row lands.
    var visibleStreamingText: String {
        if let tailEntryId, entryIds.contains(tailEntryId) { return "" }
        return streamingText
    }

    /// Whether a live passage block belongs at the end of the manuscript.
    var showsTail: Bool {
        isLive || !visibleStreamingText.isEmpty
    }

    var isLive: Bool {
        status == .pending || status == .thinking || status == .streaming
    }

    var isStoppable: Bool { isLive }

    /// The writer's own turn, echoed until its persisted row arrives.
    var optimisticUserText: String? {
        guard let echo else { return nil }
        if let entryId = echo.entryId, entryIds.contains(entryId) { return nil }
        return echo.text
    }

    /// True while the echo is still unacknowledged by the server.
    var optimisticUserPending: Bool { echo != nil && echo?.entryId == nil }

    /// Entries hidden ahead of the server: the take a retry replaces.
    var hiddenEntryIds: Set<String> {
        Set(removingEntryIds.filter { entryIds.contains($0) })
    }

    var canUndo: Bool { !busy && (workspace?.story?.canUndo ?? false) }
    var canRedo: Bool { !busy && (workspace?.story?.canRedo ?? false) }
    var canRetry: Bool { !busy && (workspace?.story?.entries.last?.isGenerated ?? false) }

    var undoLabel: String {
        workspace?.story?.undoSummary.map { "Undo · \($0)" } ?? "Undo"
    }

    var redoLabel: String {
        workspace?.story?.redoSummary.map { "Redo · \($0)" } ?? "Redo"
    }

    // MARK: - Moves

    /// Sends a Do or Say. Returns true when the text was accepted and the composer may clear.
    @discardableResult
    func send(_ text: String, kind: ActionKind) -> Bool {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return false }
        // The same transform the server runs, so the echo and the row that
        // replaces it are identical and the swap is invisible.
        let echo = ActionVoice.translate(kind, trimmed)
        if echo.isEmpty {
            notices.error(kind == .say
                ? "Nothing to say yet — those quotes are empty."
                : "Nothing to send yet — write something first.")
            return false
        }
        return start(kind: kind, userText: trimmed, echo: echo, requestKind: .generate, restoreOnFailure: text)
    }

    func continueStory() {
        start(requestKind: .continue)
    }

    /// Regenerates the last passage as a new take, optionally with another profile or model.
    func retryLast(profileId: String? = nil, modelId: String? = nil) {
        guard canRetry, let last = workspace?.story?.entries.last else { return }
        start(
            requestKind: .retry,
            variantGroupId: last.variantGroupId,
            removing: [last.id],
            profileId: profileId,
            modelId: modelId
        )
    }

    func undo() {
        moveHistory { [api, storyId] in try await api.undo(storyId: storyId) }
    }

    func redo() {
        moveHistory { [api, storyId] in try await api.redo(storyId: storyId) }
    }

    /// Asks the server to abort the run. The end frame, not this call, settles the screen.
    func stop() {
        guard active else { return }
        if runId == nil { stopDuringStart = true }
        let runId = runId
        let startTurnId = startTurnId
        Task { [api, storyId, notices] in
            do {
                try await api.stopGeneration(storyId: storyId, runId: runId, startTurnId: startTurnId)
            } catch is CancellationError {
            } catch {
                notices.error("Couldn't reach the server to stop.")
            }
        }
    }

    // MARK: - Attaching

    /// Watches a run without owning it: nil probes "is anything running?", a
    /// run id follows a run-started from another device.
    func attach(_ runId: String?) {
        if active || reader != nil {
            if let runId, runId != self.runId { pendingAttach = runId }
            return
        }
        startReader(runId)
    }

    /// Foreground or reconnect: swap a socket that may have died silently.
    func wake() {
        if let runId {
            reader?.cancel()
            startReader(runId)
            return
        }
        if active { return }
        attach(nil)
    }

    /// The server's own list of live runs, the backstop for a missed handoff.
    func reconcile(liveRuns: [ActiveRun]) {
        if active || reader != nil { return }
        guard liveRuns.contains(where: { $0.storyId == storyId }) else { return }
        attach(nil)
    }

    /// Detaches every listener. The run, if any, keeps going on the server.
    func detach() {
        reader?.cancel()
        reader = nil
        settleTimer?.cancel()
        costRefresh?.cancel()
    }

    /// Called whenever the workspace applies fresh rows.
    func workspaceDidRefresh() {
        guard status == .settling else { return }
        let echoLanded = echo?.entryId.map(entryIds.contains) ?? true
        let tailLanded = tailEntryId.map(entryIds.contains) ?? true
        if echoLanded && tailLanded { reset() }
    }

    // MARK: - Starting

    @discardableResult
    private func start(
        kind: ActionKind? = nil,
        userText: String? = nil,
        echo echoText: String? = nil,
        requestKind: GenerationRequestKind,
        variantGroupId: String? = nil,
        removing: [String] = [],
        profileId: String? = nil,
        modelId: String? = nil,
        restoreOnFailure: String? = nil
    ) -> Bool {
        guard !active else { return false }
        active = true

        // A probe may still be in flight; this start supersedes it. If a run
        // really is live the server refuses the start, and that is the answer.
        reader?.cancel()
        reader = nil
        unownedText = restoreOnFailure

        let turnId = RandomID.make()
        startTurnId = turnId
        stopDuringStart = false
        status = .pending
        streamingText = ""
        usage = nil
        tailEntryId = nil
        echo = echoText.map { Echo(text: $0, entryId: nil) }
        removingEntryIds = removing
        isStarting = true

        Task {
            defer { isStarting = false }
            do {
                let started = try await api.startGeneration(
                    storyId: storyId,
                    kind: kind,
                    userText: userText,
                    turnId: turnId,
                    variantGroupId: variantGroupId,
                    removingEntryIds: removing,
                    requestKind: requestKind,
                    profileId: profileId,
                    modelId: modelId
                )
                unownedText = nil
                runId = started.runId
                if pendingAttach == started.runId { pendingAttach = nil }
                if stopDuringStart {
                    stopDuringStart = false
                    Task { [api, storyId] in try? await api.stopGeneration(storyId: storyId, runId: started.runId) }
                }
                if let userEntryId = started.userEntryId {
                    refreshOwed = true
                    echo?.entryId = userEntryId
                }
                startReader(started.runId)
            } catch is CancellationError {
                reset()
            } catch {
                fail((error as? LocalizedError)?.errorDescription ?? "Generation failed. Try again.")
            }
        }
        return true
    }

    private func fail(_ message: String) {
        notices.error(message)
        if let unowned = unownedText {
            unownedText = nil
            workspace?.restoreComposerText(unowned)
        }
        refreshIfOwed()
        reset()
    }

    private func moveHistory(_ move: @escaping () async throws -> HistoryMove?) {
        guard !active else { return }
        active = true
        isMovingHistory = true
        Task {
            do {
                _ = try await move()
            } catch is CancellationError {
            } catch {
                notices.error(error, fallback: "Couldn't change the history.")
            }
            await workspace?.refreshNow()
            isMovingHistory = false
            releaseSlot()
        }
    }

    // MARK: - Reading

    private func startReader(_ runId: String?) {
        readerToken += 1
        let token = readerToken
        reader = Task { [weak self] in
            await self?.read(runId, token: token)
        }
    }

    /// Subscribe, mirror, and re-attach on failure until the run ends. Only an
    /// answer — a 204 or a terminal frame — ends it locally.
    private func read(_ requestedRunId: String?, token: Int) async {
        var adopted = false
        var attempt = 0
        while !Task.isCancelled {
            let stream: AsyncThrowingStream<RunWireEvent, Error>?
            do {
                stream = try await api.subscribeRun(storyId: storyId, runId: runId ?? requestedRunId)
            } catch {
                if Task.isCancelled { return }
                if attempt + 1 == SyncTiming.subscribeFailureNotice, adopted || runId != nil {
                    notices.error("Lost the connection to the generation — retrying.")
                }
                try? await Task.sleep(for: SyncTiming.reattachDelay(after: attempt))
                attempt += 1
                continue
            }

            guard let stream else {
                if Task.isCancelled { return }
                if adopted || runId != nil {
                    // The run finished while nobody here was listening. Its row
                    // is persisted; settle and let the refresh deliver it.
                    runEnded(RunWireEvent.End(status: .aborted, entryId: nil, error: nil, usage: nil))
                } else if token == readerToken {
                    reader = nil
                    if let pending = pendingAttach {
                        pendingAttach = nil
                        attach(pending)
                    }
                }
                return
            }

            attempt = 0
            do {
                let result = try await consume(stream)
                if result.ended || Task.isCancelled { return }
                adopted = adopted || result.adopted
            } catch {
                if Task.isCancelled { return }
            }
            try? await Task.sleep(for: SyncTiming.reattachDelay(after: attempt))
            attempt += 1
        }
    }

    private func consume(_ stream: AsyncThrowingStream<RunWireEvent, Error>) async throws -> (ended: Bool, adopted: Bool) {
        var full = ""
        var adopted = false
        for try await event in stream {
            if Task.isCancelled { return (false, adopted) }
            switch event {
            case .run(let frame):
                adopted = true
                adopt(frame)
                full = frame.text
            case .text(let value):
                full += value
                streamingText = full
                status = .streaming
            case .reasoning:
                // Only a promotion out of pending: once prose arrives, writing is the honest label.
                if status == .pending { status = .thinking }
            case .usage(let value):
                usage = value
            case .end(let end):
                runEnded(end)
                return (true, adopted)
            case .ping, .unknown:
                continue
            }
        }
        return (false, adopted)
    }

    private func adopt(_ frame: RunWireEvent.Frame) {
        active = true
        runId = frame.runId
        if pendingAttach == frame.runId { pendingAttach = nil }
        streamingText = frame.text
        removingEntryIds = frame.removingEntryIds
        status = !frame.text.isEmpty ? .streaming : frame.reasoningChars > 0 ? .thinking : .pending
    }

    /// The terminal frame. The server has already persisted the passage, so
    /// everything here is display: square the buffer with the row and settle.
    private func runEnded(_ end: RunWireEvent.End) {
        reader = nil
        runId = nil
        if end.status == .error, let message = end.error { notices.error(message) }
        if let endUsage = end.usage { usage = endUsage }
        if let entryId = end.entryId {
            streamingText = streamingText.trimmingCharacters(in: .whitespacesAndNewlines)
            tailEntryId = entryId
        } else {
            streamingText = ""
        }
        status = .settling

        // Every device refreshes: the web's passive mirrors ride the bus
        // change, but a refresh here costs one read and never misses.
        refreshOwed = false
        Task { await workspace?.refreshNow() }
        // A stop or a mid-stream failure is priced after the fact.
        if end.status != .ok { scheduleCostRefresh() }

        settleTimer?.cancel()
        settleTimer = Task { [weak self] in
            try? await Task.sleep(for: SyncTiming.settleTimeout)
            guard !Task.isCancelled, let self, self.status == .settling else { return }
            self.reset()
        }
        workspaceDidRefresh()
    }

    private func reset() {
        reader = nil
        runId = nil
        startTurnId = nil
        stopDuringStart = false
        settleTimer?.cancel()
        status = .idle
        streamingText = ""
        echo = nil
        tailEntryId = nil
        removingEntryIds = []
        releaseSlot()
    }

    /// The one way the re-entry slot is given back: a latched run-started is chased now.
    private func releaseSlot() {
        active = false
        let pending = pendingAttach
        pendingAttach = nil
        attach(pending)
    }

    private func refreshIfOwed() {
        guard refreshOwed else { return }
        refreshOwed = false
        Task { await workspace?.refreshNow() }
    }

    private func scheduleCostRefresh() {
        costRefresh?.cancel()
        costRefresh = Task { [weak self] in
            try? await Task.sleep(for: SyncTiming.reconcileRefreshDelay)
            guard !Task.isCancelled else { return }
            await self?.workspace?.refreshNow()
        }
    }
}
