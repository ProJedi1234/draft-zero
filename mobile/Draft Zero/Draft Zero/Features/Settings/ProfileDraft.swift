import Foundation

/// The profile editor's working copy. Nothing is written until save, so this
/// is plain state rather than something that follows the server.
nonisolated struct ProfileDraft: Equatable, Sendable {
    var name: String
    var settings: ProfileSettings
    /// Promote the profile to default after saving it.
    var makeDefault = false

    init(name: String, settings: ProfileSettings) {
        self.name = name
        self.settings = settings
    }

    /// A create starts from the seed with no name; a duplicate names itself "… copy".
    init(target: ProfileEditorTarget, models: [OpenRouterModel]) {
        guard let profile = target.profile else {
            self.init(name: "", settings: Self.blankSettings(models: models))
            return
        }
        let name = switch target.mode {
        case .create: ""
        case .duplicate: "\(profile.name) copy"
        case .edit: profile.name
        }
        self.init(name: name, settings: profile.settings)
    }

    /// Every slider inherits: a new profile has no opinions until given some.
    static func blankSettings(models: [OpenRouterModel]) -> ProfileSettings {
        ProfileSettings(
            modelId: models.first?.id ?? "",
            thinking: .off,
            providerTag: nil,
            zdr: false,
            temperature: nil,
            topP: nil,
            contextWindow: nil,
            loreBudget: nil,
            frequencyPenalty: nil,
            presencePenalty: nil
        )
    }

    var trimmedName: String {
        name.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// A model switch drops the pin, keeps only a thinking level the new model
    /// offers, and brings an overridden window down to fit. An inherited window
    /// stays inherited: the clamp applies to it at send time.
    mutating func chooseModel(_ modelId: String, in models: [OpenRouterModel]) {
        guard modelId != settings.modelId else { return }
        let model = models.first { $0.id == modelId }
        settings.modelId = modelId
        settings.providerTag = nil
        settings.thinking = ModelCatalog.levelForModel(model?.reasoning, current: settings.thinking)
        if let window = settings.contextWindow {
            settings.contextWindow = GenerationLimits.clampContextWindow(window, contextLength: model?.contextLength ?? 0)
        }
    }

    /// A pinned endpoint may serve a shorter window than the model.
    mutating func chooseProvider(_ tag: String?, contextLength: Int) {
        guard tag != settings.providerTag else { return }
        settings.providerTag = tag
        if let window = settings.contextWindow {
            settings.contextWindow = GenerationLimits.clampContextWindow(window, contextLength: contextLength)
        }
    }

    /// What goes on the wire: an overridden window clamped to what the writer
    /// could see, an inherited one as the nil it is.
    func settingsForSave(contextLength: Int) -> ProfileSettings {
        var saved = settings
        if let window = saved.contextWindow {
            saved.contextWindow = GenerationLimits.clampContextWindow(window, contextLength: contextLength)
        }
        return saved
    }

    var validationMessage: String? {
        SettingsValidation.profile(name: name, settings: settings)
    }
}
