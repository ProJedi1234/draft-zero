import Foundation
import Observation

/// One story's lorebook screen: the entries, the open editors, the list's
/// filter and selection, and the sync wiring that keeps them current.
///
/// Rows live in a `LorebookLedger`, which merges replies, sync events and
/// complete reads by version. Each entry being edited, or being toggled from
/// the list, has a `LorebookEntryEditor` whose draft overlays its row, so the
/// list shows the writer's edits as they type and remote rows never clobber them.
@Observable
final class LorebookModel {
    enum LoadState: Equatable {
        case loading
        case loaded
        case failed(String)
    }

    let storyId: String

    private(set) var loadState: LoadState = .loading
    private(set) var ledger = LorebookLedger()
    /// Entry ids in display order; see `LorebookListing.stableOrder`.
    private(set) var order: [String] = []
    private(set) var editors: [String: LorebookEntryEditor] = [:]

    var filter: LorebookFilter = .all
    var query = ""

    /// The entry open in the editor: the split's detail, or the pushed page.
    var selectedId: String? {
        didSet {
            guard selectedId != oldValue else { return }
            if let oldValue { close(oldValue) }
            if let selectedId { open(selectedId) }
        }
    }

    /// Whether the editor sits beside the list rather than being pushed over it.
    var usesSplitLayout = false

    var isCreatingEntry = false
    var isPickingCardFile = false
    private(set) var isImporting = false
    var importReport: LorebookMergeReport?
    var importError: String?

    var isShowingImportError: Bool {
        get { importError != nil }
        set { if !newValue { importError = nil } }
    }

    @ObservationIgnored private let api: APIClient
    @ObservationIgnored private let sync: SyncChannel
    @ObservationIgnored private let notices: NoticeCenter
    @ObservationIgnored private var subscriptions: [SyncSubscription] = []
    @ObservationIgnored private var visibleSurfaces = 0
    @ObservationIgnored private var refreshTask: Task<Void, Never>?
    @ObservationIgnored private var refreshAgain = false
    @ObservationIgnored private var scheduledRefresh: Task<Void, Never>?
    @ObservationIgnored private var launchSelectionPending = true

    init(storyId: String, api: APIClient, sync: SyncChannel, notices: NoticeCenter) {
        self.storyId = storyId
        self.api = api
        self.sync = sync
        self.notices = notices
    }

    // MARK: - Derived

    /// Every entry in display order, with open drafts on top of their rows.
    var entries: [LorebookEntry] {
        order.compactMap(displayed)
    }

    var visibleEntries: [LorebookEntry] {
        LorebookListing.visible(entries, filter: filter, query: query)
    }

    var sections: [LorebookSection] {
        LorebookListing.sections(visibleEntries)
    }

    var isSearching: Bool {
        !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    func count(_ filter: LorebookFilter) -> Int {
        entries.count(where: filter.admits)
    }

    func displayed(_ id: String) -> LorebookEntry? {
        guard let row = ledger.entry(id) else { return nil }
        return editors[id]?.displayed ?? row
    }

    /// Where a new entry starts: the category being browsed, like the filter says.
    var newEntryCategory: LorebookCategory {
        filter.category ?? .character
    }

    /// Enabled entries whose keys this entry's content names: what it brings with
    /// it into the context, one cascade step on.
    func cascade(from entryId: String) -> [LorebookEntry] {
        guard let source = displayed(entryId), !source.content.isEmpty else { return [] }
        let others = entries.filter { $0.id != entryId }
        return LoreMatcher.matchActive(others, sources: [LoreMatcher.ScanSource(id: .story, text: source.content.lowercased())])
            .filter { $0.depth == 0 && $0.triggeredBy != nil }
            .map(\.entry)
    }

    // MARK: - Lifecycle

    /// A surface of this screen (the list, or the pushed editor) came on screen.
    func surfaceAppeared() {
        visibleSurfaces += 1
        guard subscriptions.isEmpty else { return }
        subscriptions = [
            sync.subscribe { [weak self] event in self?.handle(event) },
            sync.onReconnect { [weak self] in self?.scheduleRefresh() },
        ]
        Task { await refreshNow() }
    }

    /// Stops listening once neither surface is showing. Deferred a turn, since a
    /// push reports the list gone before or after the editor arrives.
    func surfaceDisappeared() {
        visibleSurfaces = max(visibleSurfaces - 1, 0)
        Task { [weak self] in
            guard let self, self.visibleSurfaces == 0 else { return }
            self.stop()
        }
    }

    private func stop() {
        for subscription in subscriptions { subscription.release() }
        subscriptions = []
        scheduledRefresh?.cancel()
        flushAll()
    }

    /// Sends every pending edit now, for backgrounding or leaving.
    func flushAll() {
        for editor in editors.values where !editor.isSettled {
            editor.flush()
        }
    }

    // MARK: - Reading

    /// Reads the story's whole lorebook; overlapping calls coalesce into one trailing read.
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
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            await self?.refreshNow()
        }
    }

    /// The first load failed and the writer asked again.
    func retry() {
        loadState = .loading
        Task { await refreshNow() }
    }

    private func load() async {
        let issuedAt = ledger.ingestSeq
        do {
            let rows = try await api.lorebook(storyId: storyId)
            applySnapshot(rows, issuedAt: issuedAt)
        } catch is CancellationError {
            return
        } catch {
            if loadState != .loaded {
                loadState = .failed((error as? LocalizedError)?.errorDescription ?? "Couldn't load the lorebook.")
            }
        }
    }

    /// A complete read landed. Internal so tests can drive it.
    func applySnapshot(_ rows: [LorebookEntry], issuedAt: Int) {
        let before = ledger
        let swept = ledger.applySnapshot(rows, issuedAt: issuedAt)
        loadState = .loaded
        rowsChanged(from: before, removed: swept, remotely: true)
        applyLaunchSelection()
    }

    /// `-openLorebookEntry <id>` opens an entry once it has loaded, so a simulator
    /// run can land in the editor.
    private func applyLaunchSelection() {
        guard launchSelectionPending else { return }
        launchSelectionPending = false
        if let id = UserDefaults.standard.string(forKey: "openLorebookEntry"), ledger.entry(id) != nil {
            selectedId = id
        }
    }

    // MARK: - Sync

    func handle(_ event: SyncWireEvent) {
        switch event {
        case .change(let changed) where changed == storyId:
            scheduleRefresh()
        case .entity(let entity) where entity.entity == "lorebook-entry":
            handleEntity(entity)
        default:
            break
        }
    }

    private func handleEntity(_ entity: SyncWireEvent.Entity) {
        if entity.op == "delete" {
            guard entity.storyId == storyId || ledger.entry(entity.id) != nil else { return }
            let before = ledger
            ledger.delete(entity.id, version: entity.version)
            rowsChanged(from: before, removed: before.entry(entity.id) == nil ? [] : [entity.id], remotely: entity.origin != api.origin)
            return
        }
        guard case .lorebookEntry(let entry) = entity.payload else {
            if entity.storyId == storyId { scheduleRefresh() }
            return
        }
        guard entry.storyId == storyId else { return }
        let before = ledger
        // Our own echo carries a row the write's reply already folded in; the
        // version check turns it away, and adopts it if it outran the reply.
        guard ledger.upsert(entry) else { return }
        rowsChanged(from: before, removed: [], remotely: true)
    }

    /// Pushes moved rows into open drafts, re-orders on a changed set, and moves
    /// the selection off anything that disappeared.
    private func rowsChanged(from before: LorebookLedger, removed: Set<String>, remotely: Bool) {
        for (id, editor) in editors {
            if let row = ledger.entry(id) { editor.adopt(row) }
        }
        let previousRows = displayOrder(in: before)
        order = LorebookListing.stableOrder(previous: order, entries: ledger.entries)
        for id in removed {
            entryDisappeared(id, previousRows: previousRows, remotely: remotely)
        }
    }

    /// Entry ids top to bottom as the list shows them, sections and all.
    private func displayOrder(in ledger: LorebookLedger) -> [String] {
        let shown: [LorebookEntry] = order.compactMap { id in
            guard let row = ledger.entry(id) else { return nil }
            if let draft = editors[id]?.draft { return row.overlaid(with: draft) }
            return row
        }
        return LorebookListing.sections(LorebookListing.visible(shown, filter: filter, query: query))
            .flatMap { $0.entries.map(\.id) }
    }

    private func entryDisappeared(_ id: String, previousRows: [String], remotely: Bool) {
        let name = editors[id]?.displayed.name
        editors[id]?.cancel()
        editors[id] = nil
        guard selectedId == id else { return }
        if usesSplitLayout {
            selectedId = LorebookListing.nextSelection(previousOrder: previousRows, alive: displayOrder(in: ledger), gone: id)
        } else {
            selectedId = nil
        }
        if remotely, let name {
            notices.info("“\(name)” was deleted on another device.")
        }
    }

    // MARK: - Selection and editors

    /// On the split layout an editor is always showing something once there is something.
    func selectFirstIfNeeded() {
        guard usesSplitLayout, selectedId == nil || displayed(selectedId ?? "") == nil else { return }
        selectedId = sections.first?.entries.first?.id
    }

    @discardableResult
    private func open(_ id: String) -> LorebookEntryEditor? {
        if let editor = editors[id] { return editor }
        guard let row = ledger.entry(id) else { return nil }
        let editor = LorebookEntryEditor(entry: row) { [api] entryId, patch in
            try await api.updateLorebookEntry(entryId, patch: patch)
        }
        editor.onSaved = { [weak self] record in self?.fold(record) }
        editor.onMissing = { [weak self] id in self?.vanished(id) }
        editor.onRevert = { [weak self] error in self?.notices.error(error) }
        editor.onSettled = { [weak self] id in self?.releaseIfIdle(id) }
        editors[id] = editor
        return editor
    }

    /// The editor stays until its last save lands; a clean, closed one goes.
    private func close(_ id: String) {
        guard let editor = editors[id] else { return }
        editor.discardBlankName()
        editor.flush()
        // Closing is when a rename may finally move its row.
        order = LorebookListing.sorted(ledger.entries)
        releaseIfIdle(id)
    }

    private func releaseIfIdle(_ id: String) {
        guard id != selectedId, editors[id]?.isSettled == true else { return }
        editors[id] = nil
    }

    private func fold(_ record: LorebookEntry) {
        let before = ledger
        guard ledger.upsert(record) else { return }
        rowsChanged(from: before, removed: [], remotely: false)
    }

    private func vanished(_ id: String) {
        let before = ledger
        ledger.delete(id, version: before.entry(id)?.updatedAt ?? "")
        rowsChanged(from: before, removed: [id], remotely: true)
    }

    // MARK: - Writes

    func setEnabled(_ id: String, _ enabled: Bool) {
        open(id)?.draft.enabled = enabled
    }

    func setAlwaysActive(_ id: String, _ alwaysActive: Bool) {
        open(id)?.draft.alwaysActive = alwaysActive
    }

    /// Creates an entry under a client-minted id, so a retry after a lost reply
    /// lands on the row the first attempt wrote. Selects it on success.
    func create(_ draft: NewLorebookEntry, id: String) async throws {
        var entry = draft
        entry.name = draft.name.trimmingCharacters(in: .whitespacesAndNewlines)
        let record = try await api.createLorebookEntry(storyId: storyId, id: id, entry: entry)
        fold(record)
        if !filter.admits(record) { filter = .all }
        if !LorebookListing.matches(record, query: query) { query = "" }
        selectedId = record.id
    }

    /// Hides the entry at once and puts it back if the server refuses. The
    /// tombstone stays after success: ids are never reused, so any upsert still
    /// in flight for this one is stale.
    func delete(_ id: String) {
        let before = ledger
        editors[id]?.cancel()
        let removed = ledger.beginDelete(id)
        rowsChanged(from: before, removed: [id], remotely: false)
        Task {
            do {
                try await api.deleteLorebookEntry(id)
            } catch let error as APIError where error.isNotFound {
                return
            } catch {
                let failed = ledger
                ledger.cancelDelete(id, restoring: removed)
                rowsChanged(from: failed, removed: [], remotely: false)
                notices.error(error, fallback: "Couldn't delete that entry.")
            }
        }
    }

    // MARK: - Import

    /// The file picker closed.
    func importPicked(_ result: Result<URL, Error>) {
        switch result {
        case .success(let url):
            Task { await importCards(from: url) }
        case .failure(let error):
            if (error as? CocoaError)?.code == .userCancelled { return }
            importError = (error as? LocalizedError)?.errorDescription ?? "That file couldn't be opened."
        }
    }

    /// Merges an AI Dungeon card export into this lorebook, then reports what it did.
    func importCards(from url: URL) async {
        isImporting = true
        defer { isImporting = false }
        do {
            let json = try await LorebookCardFile.read(url)
            let summary = try await api.mergeStoryCards(storyId: storyId, json: json)
            filter = .all
            query = ""
            importReport = LorebookMergeReport(summary)
            await refreshNow()
        } catch is CancellationError {
            return
        } catch {
            importError = (error as? LocalizedError)?.errorDescription ?? "That import couldn't be completed. Nothing was saved."
        }
    }
}
