import Foundation
import Observation

/// The composer's unsent state, and its magic sync. A port of the editor state
/// in components/story/story-workspace.tsx and hooks/use-composer-draft-sync.ts.
///
/// Every change the writer makes is debounced into POST /api/draft, which saves
/// the row and announces it to the other devices. Their changes arrive as
/// `draft` events and are adopted unless they are our own echo, older than what
/// is on display, or racing a save of ours that has not been acknowledged.
/// Adopted values never publish, or two devices would volley forever.
///
/// Every save also writes the composer to the device, so words typed with no
/// server survive a relaunch and go out once a fresh read finds nothing newer.
/// A newer row from the server wins over them, as a newer event does.
@Observable
final class ComposerModel {
    /// Whether the next image send develops the brief or draws.
    enum ImageSendAction {
        case develop
        case draw
    }

    /// The brief and mutes the developed lane answers.
    struct DevelopedFor: Equatable {
        var brief: String
        var muteKey: String
    }

    var text = "" {
        didSet {
            guard !applyingRemote, text != oldValue else { return }
            // A cleared brief is a cleared question; its mutes go with it.
            if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { excludedLoreIds = [] }
            publish()
        }
    }

    var mode: ComposerMode = .do {
        didSet {
            if mode != .image { lastWritingMode = mode }
            guard !applyingRemote, mode != oldValue else { return }
            publish()
        }
    }

    /// The displayed developed prompt, which during a develop is a half-written sentence.
    var imagePrompt: String? {
        didSet {
            guard !applyingRemote, imagePrompt != oldValue else { return }
            publishedImagePrompt = imagePrompt
            publish()
        }
    }

    /// False is verbatim: the writer's words go to the image model untouched.
    var imageAssisted = true {
        didSet {
            guard !applyingRemote, imageAssisted != oldValue else { return }
            publish()
        }
    }

    /// Art direction appended to the next draw, or nil for none.
    var imageStyle: String? {
        didSet {
            guard !applyingRemote, imageStyle != oldValue else { return }
            publish()
        }
    }

    /// Lore chips the writer muted under the current brief.
    private(set) var excludedLoreIds: Set<String> = []
    /// Remembered across sends on this device, like the web.
    var aspectRatio: ImageAspectRatio = .landscape
    /// The writing move to return to when leaving image mode.
    private(set) var lastWritingMode: ComposerMode = .do
    private(set) var developedFor: DevelopedFor?
    /// Flips when a develop settles, so the view can announce the lane.
    private(set) var laneReadyAnnouncement = 0
    /// Bumped to ask the text field to take focus.
    private(set) var focusRequest = 0

    @ObservationIgnored weak var derivation: DerivationController?
    @ObservationIgnored private let storyId: String
    @ObservationIgnored private let api: APIClient
    @ObservationIgnored private let notices: NoticeCenter
    @ObservationIgnored private var applyingRemote = false
    /// What other devices have been told the lane holds; differs from the display mid-develop.
    @ObservationIgnored private var publishedImagePrompt: String?
    /// The version of the draft on display.
    @ObservationIgnored private var version: String?
    /// Non-nil while a change of ours is unacknowledged; suspends adoption.
    @ObservationIgnored private var pendingSeq: Int?
    @ObservationIgnored private var seq = 0
    @ObservationIgnored private var queued: (seq: Int, payload: DraftPayload)?
    @ObservationIgnored private var saveTimer: Task<Void, Never>?
    @ObservationIgnored private var lastSaveFailed = false
    /// The server has not acknowledged what the composer holds.
    @ObservationIgnored private(set) var unsent = false
    @ObservationIgnored private let local: LocalStore?

    init(storyId: String, api: APIClient, notices: NoticeCenter, seed: ComposerDraft?, local: LocalStore? = nil) {
        self.storyId = storyId
        self.api = api
        self.notices = notices
        self.local = local
        if let seed { apply(seed) }
        if seed?.imagePrompt != nil {
            developedFor = DevelopedFor(brief: brief, muteKey: Self.muteKey(excludedLoreIds))
        }
    }

    // MARK: - Derived

    var brief: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }
    var hasText: Bool { !brief.isEmpty }
    var lane: String { imagePrompt?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "" }
    private var deriving: Bool { derivation?.deriving ?? false }

    var laneStale: Bool {
        guard let developedFor else { return false }
        return developedFor.brief != brief || developedFor.muteKey != Self.muteKey(excludedLoreIds)
    }

    var laneReady: Bool { imageAssisted && !lane.isEmpty && !laneStale && !deriving }
    var laneVisible: Bool { imageAssisted && (deriving || imagePrompt != nil) }

    var imageSendAction: ImageSendAction {
        !imageAssisted || laneReady ? .draw : .develop
    }

    var placeholder: String {
        mode == .image && !imageAssisted ? "Describe the image…" : mode.placeholder
    }

    /// The lore chips a brief summons, only while an assisted image is armed.
    func loreMatches(in lorebook: [LorebookEntry]) -> [LoreMatcher.Match] {
        guard mode == .image, imageAssisted else { return [] }
        return LoreMatcher.matchBrief(lorebook, brief: text)
    }

    /// What actually rides with the draw: matched, minus mutes, within budget.
    func includedLoreIds(in lorebook: [LorebookEntry]) -> [String] {
        guard mode == .image, imageAssisted else { return [] }
        return LoreMatcher.selectBrief(lorebook, brief: text, excluding: excludedLoreIds).map(\.entry.id)
    }

    /// The lane as editable text; clearing it keeps an empty lane open, as on the web.
    var imagePromptText: String {
        get { imagePrompt ?? "" }
        set { imagePrompt = newValue }
    }

    // MARK: - Writer's changes

    func requestFocus() {
        focusRequest += 1
    }

    func toggleLore(_ id: String) {
        if excludedLoreIds.contains(id) {
            excludedLoreIds.remove(id)
        } else {
            excludedLoreIds.insert(id)
        }
        publish()
    }

    func clearExcludedLore() {
        guard !excludedLoreIds.isEmpty else { return }
        excludedLoreIds = []
        publish()
    }

    func leaveImageMode() {
        mode = lastWritingMode
    }

    /// Tab's move: the other writing mode.
    func swapWritingMode() {
        mode = mode == .say ? .do : .say
    }

    /// Records that the lane now answers this brief, so ↵ draws instead of developing again.
    func markDeveloped(brief developedBrief: String?) {
        developedFor = developedBrief.map { DevelopedFor(brief: $0, muteKey: Self.muteKey(excludedLoreIds)) }
    }

    /// Clears the composer after a send. Publishes like any other change.
    func clearAfterImageSend() {
        text = ""
        imagePrompt = nil
        developedFor = nil
    }

    /// Hands a picture's prompt back as the two lanes it came from, armed to redraw it.
    func restoreImagePrompt(prompt: String, sourcePrompt: String?) {
        let split = ImageStyles.split(prompt)
        imageStyle = split.style
        if let sourcePrompt {
            text = sourcePrompt
            imagePrompt = split.scene
            markDeveloped(brief: sourcePrompt.trimmingCharacters(in: .whitespacesAndNewlines))
        } else {
            text = split.scene
            imagePrompt = nil
            markDeveloped(brief: nil)
        }
        mode = .image
    }

    // MARK: - Develop callbacks

    /// The prompt so far, on every increment. Display only; never published.
    func derivationText(_ value: String) {
        applyingRemote = true
        imagePrompt = value
        applyingRemote = false
    }

    /// The run already persisted and announced the settled prompt; catch the published value up.
    func derivationSettled(_ value: String) {
        publishedImagePrompt = value
        applyingRemote = true
        imagePrompt = value
        applyingRemote = false
    }

    /// A develop that produced nothing folds the lane; only the launching device writes that down.
    func derivationDiscarded(persist: Bool) {
        if persist {
            imagePrompt = nil
        } else {
            applyingRemote = true
            imagePrompt = nil
            applyingRemote = false
        }
    }

    /// The falling edge of a develop: date the lane by the question the run answered.
    func derivationEnded(brief derivedBrief: String?, excludedLoreIds derived: [String]?) {
        developedFor = DevelopedFor(
            brief: derivedBrief ?? brief,
            muteKey: Self.muteKey(derived.map(Set.init) ?? excludedLoreIds)
        )
        laneReadyAnnouncement += 1
    }

    // MARK: - Sync in

    /// Adopts another device's change, unless it is ours, stale, or racing our own save.
    func adopt(_ event: SyncWireEvent.Draft, selfOrigin: String) {
        guard event.storyId == storyId, event.origin != selfOrigin, pendingSeq == nil else { return }
        if let version, event.version <= version { return }
        version = event.version
        apply(ComposerDraft(
            text: event.text,
            mode: event.mode,
            imagePrompt: event.imagePrompt,
            imageAssisted: event.imageAssisted,
            imageStyle: event.imageStyle,
            imageExcludedLoreIds: event.imageExcludedLoreIds,
            updatedAt: event.version
        ))
        unsent = false
        persist()
    }

    /// Squares the composer with a row read from the server; nil is "no row".
    func reconcile(_ row: ComposerDraft?) {
        guard pendingSeq == nil else { return }
        guard let row else {
            // Absence only means "never touched" while no version has been seen.
            if version == nil && !unsent {
                applyingRemote = true
                text = ""
                applyingRemote = false
            }
            return
        }
        if let version, row.updatedAt <= version { return }
        version = row.updatedAt
        apply(row)
        unsent = false
        persist()
    }

    /// Puts back the composer this device last left, before any server row is seen.
    func restore(_ saved: LocalDraft) {
        guard version == nil, pendingSeq == nil else { return }
        show(saved.payload)
        version = saved.version
        unsent = saved.unsent
        if saved.payload.imagePrompt != nil {
            developedFor = DevelopedFor(brief: brief, muteKey: Self.muteKey(excludedLoreIds))
        }
    }

    /// Re-reads the row after a reconnect: draft events missed while the socket was down are gone.
    func resync() {
        Task {
            do {
                let row = try await api.draft(storyId: storyId)
                reconcile(row?.asDraft)
                resendUnsent()
            } catch {
                // The next reconnect probes again.
            }
        }
    }

    private func apply(_ draft: ComposerDraft) {
        show(draft.payload)
        if version == nil { version = draft.updatedAt }
    }

    private func show(_ draft: DraftPayload) {
        applyingRemote = true
        text = draft.text
        mode = draft.mode
        imagePrompt = draft.imagePrompt
        publishedImagePrompt = draft.imagePrompt
        imageAssisted = draft.imageAssisted
        imageStyle = draft.imageStyle
        excludedLoreIds = Set(draft.imageExcludedLoreIds)
        applyingRemote = false
    }

    // MARK: - Sync out

    private var payload: DraftPayload {
        DraftPayload(
            text: text,
            mode: mode,
            imagePrompt: publishedImagePrompt,
            imageAssisted: imageAssisted,
            imageStyle: imageStyle,
            imageExcludedLoreIds: Array(excludedLoreIds)
        )
    }

    private func publish() {
        seq += 1
        pendingSeq = seq
        queued = (seq, payload)
        saveTimer?.cancel()
        saveTimer = Task { [weak self] in
            try? await Task.sleep(for: SyncTiming.draftDebounce)
            guard !Task.isCancelled else { return }
            self?.flush()
        }
    }

    /// Sends whatever the debounce is holding, now: before a develop, and when the app backgrounds.
    func flush() {
        saveTimer?.cancel()
        guard let queued else { return }
        self.queued = nil
        unsent = true
        persist()
        Task { await save(queued.seq, queued.payload) }
    }

    /// Sends what the server never acknowledged. Called only after a fresh
    /// read, so a newer row from another device has already had its chance to win.
    func resendUnsent() {
        guard unsent, pendingSeq == nil, queued == nil else { return }
        seq += 1
        pendingSeq = seq
        let sending = (seq: seq, payload: payload)
        Task { await save(sending.seq, sending.payload) }
    }

    private func save(_ seq: Int, _ payload: DraftPayload) async {
        do {
            let saved = try await api.saveDraft(storyId: storyId, draft: payload)
            if version.map({ saved > $0 }) ?? true { version = saved }
            if pendingSeq == seq {
                pendingSeq = nil
                unsent = false
            }
            lastSaveFailed = false
            // Also moves a newer unsent edit's base past our own write, or it would later lose to it.
            persist()
        } catch is CancellationError {
            pendingSeq = nil
        } catch {
            // A failed save gets no echo; waiting for one would latch adoption shut.
            pendingSeq = nil
            if !lastSaveFailed {
                notices.error(local == nil ? "Couldn't sync your draft." : "Couldn't sync your draft. It's saved on this device.")
            }
            lastSaveFailed = true
        }
    }

    private func persist() {
        local?.saveDraft(storyId, LocalDraft(payload: payload, version: version, unsent: unsent))
    }

    private static func muteKey<S: Sequence>(_ ids: S) -> String where S.Element == String {
        Set(ids).sorted().joined(separator: "\n")
    }
}
