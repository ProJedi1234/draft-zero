import Foundation
import Observation

/// What runs the story: the profile it follows or, in Custom mode, its own
/// model, endpoint, thinking, retention and six sliders. A port of
/// `hooks/use-model-settings.ts`.
///
/// Following a profile, the settings are the profile's and nothing here writes
/// them; the writer moves to Custom first, as on the web. Every control follows
/// the server through `ServerSyncedValue`, and dependent settings (a model's
/// endpoint, thinking and window) travel in one patch so the row is never
/// briefly inconsistent.
@Observable
final class StoryModelSettings {
    let profile: ServerSyncedValue<String?>
    let model: ServerSyncedValue<String>
    let provider: ServerSyncedValue<String?>
    let thinkingSync: ServerSyncedValue<ThinkingLevel>
    let zdrSync: ServerSyncedValue<Bool>
    let temperature: AutosavingField<Double>
    let topP: AutosavingField<Double>
    let contextWindow: AutosavingField<Int>
    let loreBudget: AutosavingField<Double>
    let frequencyPenalty: AutosavingField<Double>
    let presencePenalty: AutosavingField<Double>

    let endpoints = ModelEndpointsLoader()
    private(set) var policies = AccountZdrPolicies.unknown
    /// The profile this session left for Custom: enough for "based on" and a
    /// way back. Deliberately not persisted.
    private(set) var lastProfileId: String?
    private(set) var isSavingProfile = false

    @ObservationIgnored private let workspace: StoryWorkspace
    /// The ceiling the stored window was last clamped to, so it is fixed once.
    @ObservationIgnored private var fixedUpWindow: Int?

    init(workspace: StoryWorkspace, story: Story) {
        self.workspace = workspace
        let version = story.updatedAt
        let settings = story.settings
        profile = ServerSyncedValue(story.profileId, version: version)
        model = ServerSyncedValue(settings.modelId, version: version)
        provider = ServerSyncedValue(settings.providerTag, version: version)
        thinkingSync = ServerSyncedValue(settings.thinking, version: version)
        zdrSync = ServerSyncedValue(settings.zdr, version: version)
        temperature = Self.slider(settings.temperature, version: version, key: "temperature", workspace: workspace) { $0.temperature }
        topP = Self.slider(settings.topP, version: version, key: "topP", workspace: workspace) { $0.topP }
        loreBudget = Self.slider(settings.loreBudget, version: version, key: "loreBudget", workspace: workspace) { $0.loreBudget }
        frequencyPenalty = Self.slider(settings.frequencyPenalty, version: version, key: "frequencyPenalty", workspace: workspace) { $0.frequencyPenalty }
        presencePenalty = Self.slider(settings.presencePenalty, version: version, key: "presencePenalty", workspace: workspace) { $0.presencePenalty }
        contextWindow = AutosavingField(
            settings.contextWindow,
            version: version,
            debounce: .milliseconds(400),
            onFailure: .revert,
            read: { [weak workspace] in
                workspace?.story.map { ($0.settings.contextWindow, $0.updatedAt) }
            },
            persist: { [weak workspace] window in
                await workspace?.updateGenerationSettings(["contextWindow": .number(Double(window))]) ?? false
            }
        )
    }

    private static func slider(
        _ value: Double,
        version: String,
        key: String,
        workspace: StoryWorkspace,
        field: @escaping (GenerationSettings) -> Double
    ) -> AutosavingField<Double> {
        AutosavingField(
            value,
            version: version,
            debounce: .milliseconds(400),
            onFailure: .revert,
            read: { [weak workspace] in
                workspace?.story.map { (field($0.settings), $0.updatedAt) }
            },
            persist: { [weak workspace] next in
                await workspace?.updateGenerationSettings([key: .number(next)]) ?? false
            }
        )
    }

    // MARK: - Reading

    var modelId: String { model.value }
    var providerTag: String? { provider.value }
    var profileId: String? { profile.value }

    /// Bound by the thinking picker; setting it saves.
    var thinking: ThinkingLevel {
        get { thinkingSync.value }
        set { chooseThinking(newValue) }
    }

    /// Bound by the profile switcher; setting it switches.
    var profileChoice: String? {
        get { profileId }
        set { chooseProfile(newValue) }
    }

    /// The story's own retention flag, bound by the ZDR toggle; setting it saves.
    var zdr: Bool {
        get { zdrSync.value }
        set { chooseZdr(newValue) }
    }

    /// A profile id with no row, deleted elsewhere, reads as Custom, as the server resolves it.
    var followedProfile: ModelProfile? {
        guard let profileId else { return nil }
        return workspace.profiles.first { $0.id == profileId }
    }

    var isCustom: Bool { followedProfile == nil }

    /// The switcher has moved and the story hasn't caught up: everything derived
    /// from the resolved settings, the meter above all, is still the old profile's.
    var isSwitchingProfile: Bool { profile.value != workspace.story?.profileId }

    var basedOnProfile: ModelProfile? {
        guard let lastProfileId else { return nil }
        return workspace.profiles.first { $0.id == lastProfileId }
    }

    /// What the next request is routed under: the story's own flag or the app's floor.
    var effectiveZdr: Bool {
        if let followedProfile { return followedProfile.settings.zdr || workspace.requireZdr }
        return zdr || workspace.requireZdr
    }

    /// The model identity the status strip names: the controls in Custom mode,
    /// the followed profile's bundle otherwise, so an edit elsewhere shows at once.
    var identity: (modelId: String, providerTag: String?, thinking: ThinkingLevel) {
        if let followedProfile {
            let settings = followedProfile.settings
            return (settings.modelId, settings.providerTag, settings.thinking)
        }
        return (modelId, providerTag, thinking)
    }

    /// The account forces retention-free routing on the shown model's group.
    var accountEnforcesZdr: Bool {
        policies.enforces(modelId: identity.modelId)
    }

    /// The window a request can use: a pinned endpoint's, else the model's; zero is unknown.
    var contextLength: Int {
        contextLength(forProvider: providerTag)
    }

    private func contextLength(forProvider tag: String?) -> Int {
        EndpointRouting.contextLength(
            endpoints: endpoints.endpoints(for: modelId),
            tag: tag,
            zdr: zdr || workspace.requireZdr || policies.enforces(modelId: modelId),
            model: workspace.model(modelId)
        )
    }

    // MARK: - Following the server

    func apply() {
        guard let story = workspace.story else { return }
        let version = story.updatedAt
        let settings = story.settings
        profile.receive(story.profileId, version: version)
        model.receive(settings.modelId, version: version)
        provider.receive(settings.providerTag, version: version)
        thinkingSync.receive(settings.thinking, version: version)
        zdrSync.receive(settings.zdr, version: version)
        for slider in [temperature, topP, loreBudget, frequencyPenalty, presencePenalty] {
            slider.pull()
        }
        contextWindow.pull()
    }

    func flush() async {
        for slider in [temperature, topP, loreBudget, frequencyPenalty, presencePenalty] {
            await slider.flush()
        }
        await contextWindow.flush()
    }

    func loadPolicies() async {
        // Unknown locks nothing, so a failed probe needs no message.
        if let raw = try? await workspace.api.accountZdrPolicies() {
            policies = AccountZdrPolicies(raw)
        }
    }

    /// What the context-window fix-up depends on, for `.onChange`.
    var windowCeilingKey: [Int] {
        [contextLength, contextWindow.sync.server, isCustom ? 1 : 0, contextWindow.hasPendingEdit ? 1 : 0]
    }

    /// A window stored under a bigger model can exceed this one's. The ladder
    /// shows it clamped; this makes the row agree. Only in Custom mode, where
    /// the columns are what generates.
    func fixUpContextWindow() {
        guard isCustom, !contextWindow.hasPendingEdit, !isSwitchingProfile else { return }
        let saved = contextWindow.sync.server
        let clamped = GenerationLimits.clampContextWindow(saved, contextLength: contextLength)
        guard clamped != saved, fixedUpWindow != clamped else { return }
        fixedUpWindow = clamped
        var batch = SyncedWriteBatch()
        batch.stage(contextWindow.sync, clamped)
        commit(batch, patch: ["contextWindow": .number(Double(clamped))])
    }

    // MARK: - Writing

    func chooseModel(_ nextId: String) {
        // Re-picking the current model chooses nothing and must not drop the pin.
        guard nextId != modelId else { return }
        let nextModel = workspace.model(nextId)
        let nextThinking = ModelCatalog.levelForModel(nextModel?.reasoning, current: thinking)
        // Clamped from the stored window, not the shown one: the shown one may
        // sit under an endpoint ceiling this very patch removes.
        contextWindow.discardEdit()
        let nextWindow = GenerationLimits.clampContextWindow(contextWindow.sync.server, contextLength: nextModel?.contextLength ?? 0)
        var batch = SyncedWriteBatch()
        batch.stage(model, nextId)
        // A provider tag names an endpoint of the old model; back to Auto.
        batch.stage(provider, nil)
        batch.stage(thinkingSync, nextThinking)
        batch.stage(contextWindow.sync, nextWindow)
        commit(batch, patch: [
            "modelId": .string(nextId),
            "providerTag": .null,
            "thinking": .string(nextThinking.rawValue),
            "contextWindow": .number(Double(nextWindow)),
        ])
    }

    func chooseProvider(_ nextTag: String?) {
        guard nextTag != providerTag else { return }
        // The endpoint owns the window, so pinning a smaller one pulls the ladder down.
        contextWindow.discardEdit()
        let nextWindow = GenerationLimits.clampContextWindow(contextWindow.sync.server, contextLength: contextLength(forProvider: nextTag))
        var batch = SyncedWriteBatch()
        batch.stage(provider, nextTag)
        batch.stage(contextWindow.sync, nextWindow)
        commit(batch, patch: ["providerTag": .optional(nextTag), "contextWindow": .number(Double(nextWindow))])
    }

    private func chooseThinking(_ next: ThinkingLevel) {
        guard next != thinking else { return }
        var batch = SyncedWriteBatch()
        batch.stage(thinkingSync, next)
        commit(batch, patch: ["thinking": .string(next.rawValue)])
    }

    private func chooseZdr(_ next: Bool) {
        guard next != zdr else { return }
        var batch = SyncedWriteBatch()
        batch.stage(zdrSync, next)
        commit(batch, patch: ["zdr": .bool(next)])
    }

    /// Follows a profile, or nil for Custom. Only the pointer moves: the story's
    /// own columns are its custom memory, so a trip through a profile is lossless.
    func chooseProfile(_ next: String?) {
        guard next != profileId else { return }
        let previous = profileId
        let previousLast = lastProfileId
        lastProfileId = next == nil ? previous : nil
        var batch = SyncedWriteBatch()
        batch.stage(profile, next)
        let staged = batch
        Task {
            let succeeded = await workspace.setProfile(next)
            apply()
            staged.finish(succeeded)
            // The switch never happened, so neither did leaving the old profile.
            if !succeeded { lastProfileId = previousLast }
        }
    }

    /// Promotes the story's settings to a named profile, which the story then follows.
    func saveAsProfile(named name: String) async {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !isSavingProfile else { return }
        isSavingProfile = true
        defer { isSavingProfile = false }
        await flush()
        if await workspace.saveAsProfile(named: trimmed) {
            lastProfileId = nil
            apply()
            workspace.notices.info("This story now follows \(trimmed).")
        }
    }

    private func commit(_ batch: SyncedWriteBatch, patch: JSONObject) {
        guard !batch.isEmpty else { return }
        Task {
            let succeeded = await workspace.updateGenerationSettings(patch)
            apply()
            batch.finish(succeeded)
        }
    }
}
