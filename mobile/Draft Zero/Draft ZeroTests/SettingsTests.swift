import Foundation
import Testing
@testable import Draft_Zero

/// The settings screen's logic: validation to the server's ranges, the
/// profile draft's coupling, patches, wording, and the autosave state machine.
struct SettingsTests {
    private func payload() throws -> SettingsPayload {
        try FixtureLoader.decode(SettingsPayload.self, from: "settings.json")
    }

    private func profile(_ id: String, name: String, settings: ProfileSettings) -> ModelProfile {
        ModelProfile(id: id, name: name, sortOrder: 0, settings: settings)
    }

    // MARK: - Validation

    @Test func summarizerIsRefusedWithTheServersSentences() throws {
        var summarizer = try payload().settings.summarizer
        #expect(SettingsValidation.summarizer(summarizer) == nil)
        summarizer.targetWords = 10
        #expect(SettingsValidation.summarizer(summarizer) == "Summary length must be 25–2000 words.")
        summarizer.targetWords = 300
        summarizer.maxTokens = 9000
        #expect(SettingsValidation.summarizer(summarizer) == "Output cap must be 64–8192 tokens.")
        summarizer.temperature = 2.5
        #expect(SettingsValidation.summarizer(summarizer) == "Temperature must be between 0 and 2.")
        summarizer.temperature = .nan
        #expect(SettingsValidation.summarizer(summarizer) == "Temperature must be between 0 and 2.")
    }

    @Test func atmosphereChecksInTheSchemasOrder() throws {
        var atmosphere = try payload().settings.atmosphere
        #expect(SettingsValidation.atmosphere(atmosphere) == nil)
        atmosphere.passagesBetweenChecks = 0
        #expect(SettingsValidation.atmosphere(atmosphere) == "Passages between checks must be a whole number between 1 and 50.")
        atmosphere.maxTokens = 8
        #expect(SettingsValidation.atmosphere(atmosphere) == "Max tokens must be a whole number between 16 and 32000.")
        atmosphere.minConfidence = 0.99
        #expect(SettingsValidation.atmosphere(atmosphere) == "Confidence must be between 0.5 and 0.95.")
    }

    @Test func defaultsImageContextAndProfilesFollowTheLadders() throws {
        var defaults = try payload().settings.defaultGeneration
        #expect(SettingsValidation.generationDefaults(defaults) == nil)
        defaults.contextWindow = 5000
        #expect(SettingsValidation.generationDefaults(defaults) == "Unsupported context window.")
        #expect(SettingsValidation.imageContext(4096) == nil)
        #expect(SettingsValidation.imageContext(3000) == "Unsupported image context size.")

        var settings = ProfileDraft.blankSettings(models: try payload().models)
        #expect(SettingsValidation.profile(name: "  ", settings: settings) == "Name the profile.")
        #expect(SettingsValidation.profile(name: "Quality", settings: settings) == nil)
        settings.contextWindow = 5000
        #expect(SettingsValidation.profile(name: "Quality", settings: settings) == "Unsupported context window.")
        settings.modelId = " "
        #expect(SettingsValidation.profile(name: "Quality", settings: settings) == "Pick a model.")
    }

    // MARK: - Profile draft

    @Test func draftSeedsFromTheTarget() throws {
        let models = try payload().models
        let seed = try #require(try payload().profiles.first)
        #expect(ProfileDraft(target: .init(mode: .edit, profile: seed), models: models).name == "Default")
        #expect(ProfileDraft(target: .init(mode: .duplicate, profile: seed), models: models).name == "Default copy")
        let created = ProfileDraft(target: .init(mode: .create, profile: seed), models: models)
        #expect(created.name == "")
        #expect(created.settings == seed.settings)
        let blank = ProfileDraft(target: .init(mode: .create, profile: nil), models: models)
        #expect(blank.settings.modelId == models[0].id)
        #expect(blank.settings.temperature == nil && blank.settings.contextWindow == nil)
        #expect(ProfileEditorTarget(mode: .create, profile: nil).id == "create:new")
    }

    @Test func modelChangeResetsTheRouteAndClampsOnlyAnOverriddenWindow() throws {
        let models = try payload().models
        var settings = ProfileDraft.blankSettings(models: models)
        settings.providerTag = "anthropic"
        settings.thinking = .xhigh
        settings.contextWindow = 131_072
        var draft = ProfileDraft(name: "Wide", settings: settings)

        let tiny = OpenRouterModel(
            id: "lab/tiny", name: "Tiny", provider: "Lab", contextLength: 10_000, maxCompletionTokens: nil,
            pricing: .init(prompt: "$0.10", completion: "$0.20"),
            reasoning: .init(efforts: [.low, .high], mandatory: false), zdr: true, aliasTarget: nil
        )
        draft.chooseModel("lab/tiny", in: models + [tiny])
        #expect(draft.settings.modelId == "lab/tiny")
        #expect(draft.settings.providerTag == nil)
        #expect(draft.settings.thinking == .off)
        #expect(draft.settings.contextWindow == 8192)

        draft.settings.contextWindow = nil
        draft.chooseModel("~anthropic/claude-haiku-latest", in: models)
        #expect(draft.settings.contextWindow == nil)
    }

    @Test func pinnedEndpointClampsTheWindowAndSaveClampsWhatIsShown() throws {
        var settings = ProfileDraft.blankSettings(models: try payload().models)
        settings.contextWindow = 65_536
        var draft = ProfileDraft(name: "Pinned", settings: settings)
        draft.chooseProvider("groq", contextLength: 32_768)
        #expect(draft.settings.providerTag == "groq")
        #expect(draft.settings.contextWindow == 32_768)

        draft.settings.contextWindow = 131_072
        #expect(draft.settingsForSave(contextLength: 16_384).contextWindow == 16_384)
        draft.settings.contextWindow = nil
        #expect(draft.settingsForSave(contextLength: 16_384).contextWindow == nil)
    }

    @Test func bundlesDropTheirPinWhenTheModelMoves() throws {
        let models = try payload().models
        var summarizer = try payload().settings.summarizer
        summarizer.providerTag = "deepinfra/turbo"
        summarizer.thinking = .high
        summarizer.chooseModel("~google/gemini-pro-latest", in: models)
        #expect(summarizer.modelId == "~google/gemini-pro-latest")
        #expect(summarizer.providerTag == nil)
        #expect(summarizer.thinking == .high)

        summarizer.thinking = .medium
        summarizer.chooseModel(nil, in: models)
        #expect(summarizer.modelId == nil)
        #expect(summarizer.thinking == .off)

        summarizer.targetWords = 400
        summarizer.maxTokens = 2000
        summarizer.useAutoLength()
        #expect(summarizer.targetWords == nil && summarizer.maxTokens == nil)
    }

    // MARK: - Patches and wording

    @Test func defaultsPatchCarriesOnlyWhatMoved() throws {
        let old = try payload().settings.defaultGeneration
        var new = old
        #expect(GenerationDefaultsPatch.between(old, new).isEmpty)
        new.temperature = 1.1
        new.contextWindow = 16_384
        #expect(GenerationDefaultsPatch.between(old, new) == ["temperature": .number(1.1), "contextWindow": .number(16_384)])
    }

    @Test func summaryLengthAutoResolvesLikeTheServer() {
        #expect(SummaryLength.autoTarget(contextWindow: 8192) == 307)
        #expect(SummaryLength.autoTarget(contextWindow: 2048) == 150)
        #expect(SummaryLength.autoTarget(contextWindow: 131_072) == 600)
        #expect(SummaryLength.autoCap(targetWords: nil, contextWindow: 8192) == 921)
        #expect(SummaryLength.autoCap(targetWords: 100, contextWindow: 8192) == 300)
    }

    @Test func followerSentences() {
        #expect(ProfileText.followers(0) == "No stories")
        #expect(ProfileText.followers(1) == "1 story")
        #expect(ProfileText.followers(4) == "4 stories")
        #expect(ProfileText.deleteConsequence(followers: 0) == "No stories follow it.")
        #expect(ProfileText.deleteConsequence(followers: 1) == "1 story goes Custom, keeping these settings.")
        #expect(ProfileText.deleteConsequence(followers: 3) == "3 stories go Custom, keeping these settings.")
        #expect(ProfileText.editConsequence(followers: 0) == nil)
        #expect(ProfileText.editConsequence(followers: 2) == "Followed by 2 stories. They update when you save.")
    }

    @Test func connectionCheckReadsInMilliseconds() {
        #expect(ConnectionCheck.describe(.milliseconds(23)) == "Healthy · 23 ms")
        #expect(ConnectionCheck.describe(.microseconds(200)) == "Healthy · 1 ms")
    }

    // MARK: - Autosave

    @Test func autosaveWaitsForTheDebounceThenWritesOnce() async {
        let log = WriteLog<Double>()
        let value = AutosavedValue(0.9, debounce: .seconds(60), write: log.record)
        value.value = 1.0
        value.value = 1.1
        #expect(value.isPending)
        #expect(log.writes.isEmpty)
        await value.flush()
        #expect(log.writes.map(\.next) == [1.1])
        #expect(log.writes.map(\.previous) == [0.9])
        #expect(value.server == 1.1)
        #expect(!value.isPending)
    }

    @Test func autosaveHoldsOffTheServerWhileAnEditWaits() async {
        let log = WriteLog<Int>()
        let value = AutosavedValue(4096, debounce: .seconds(60), write: log.record)
        value.value = 8192
        value.receive(2048)
        #expect(value.value == 8192)
        await value.flush()
        value.receive(1024)
        #expect(value.value == 1024)
        #expect(value.server == 1024)
        #expect(log.writes.count == 1)
    }

    @Test func autosaveSkipsAnEditThatReturnsToTheServerValue() async {
        let log = WriteLog<Bool>()
        let value = AutosavedValue(false, debounce: .seconds(60), write: log.record)
        value.value = true
        value.value = false
        #expect(!value.isPending)
        await value.flush()
        #expect(log.writes.isEmpty)
    }

    @Test func autosaveRevertsAndExplainsAFailedWrite() async {
        let log = WriteLog<Double>()
        log.failure = APIError.service(code: "invalid", message: "Temperature must be between 0 and 2.", status: 400)
        let activity = SaveActivity()
        let value = AutosavedValue(0.3, debounce: .seconds(60), activity: activity, write: log.record)
        value.value = 0.5
        await value.flush()
        #expect(value.value == 0.3)
        #expect(value.error == "Temperature must be between 0 and 2.")
        #expect(activity.status == .idle)
        #expect(activity.settledWrites == 1)
    }

    @Test func autosaveRefusesWhatTheServerWouldRefuse() async {
        let log = WriteLog<Double>()
        let value = AutosavedValue(
            0.3,
            debounce: .seconds(60),
            validate: { $0 > 2 ? "Temperature must be between 0 and 2." : nil },
            write: log.record
        )
        value.value = 3
        await value.flush()
        #expect(log.writes.isEmpty)
        #expect(value.error == "Temperature must be between 0 and 2.")
        #expect(value.value == 3)
    }

    @Test func saveActivityShowsSavedAfterTheLastWrite() async throws {
        let activity = SaveActivity()
        activity.begin()
        activity.begin()
        #expect(activity.status == .saving)
        activity.end(succeeded: true)
        #expect(activity.status == .saving)
        activity.end(succeeded: true)
        #expect(activity.status == .saved)
        #expect(activity.settledWrites == 2)
    }

    // MARK: - Decision model

    /// Sent as null when following the default, so the server stores the choice
    /// rather than leaving an older one in place.
    @Test func atmosphereEncodesItsDecisionModel() throws {
        var atmosphere = try payload().settings.atmosphere
        atmosphere.decisionModelId = "ollama:tev1"
        let chosen = try JSONSerialization.jsonObject(with: JSONEncoder().encode(atmosphere)) as? [String: Any]
        #expect(chosen?["decisionModelId"] as? String == "ollama:tev1")
        atmosphere.decisionModelId = nil
        let followed = try JSONSerialization.jsonObject(with: JSONEncoder().encode(atmosphere)) as? [String: Any]
        #expect(followed?.keys.contains("decisionModelId") == true)
        #expect(followed?["decisionModelId"] is NSNull)
    }
}
