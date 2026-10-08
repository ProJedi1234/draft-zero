import Foundation

/// The app-wide settings the screen edits in place, each saving on its own.
/// Created from the first payload and fed every later one.
final class SettingsEditors {
    let defaults: AutosavedValue<GenerationDefaults>
    let summarizer: AutosavedValue<AppSettings.Summarizer>
    let atmosphere: AutosavedValue<AppSettings.Atmosphere>
    let requireZdr: AutosavedValue<Bool>
    let defaultImageModel: AutosavedValue<String?>
    let imageContext: AutosavedValue<Int>

    init(settings: AppSettings, api: APIClient, activity: SaveActivity) {
        defaults = AutosavedValue(
            settings.defaultGeneration,
            activity: activity,
            validate: SettingsValidation.generationDefaults
        ) { next, previous in
            let patch = GenerationDefaultsPatch.between(previous, next)
            if !patch.isEmpty { try await api.updateGenerationDefaults(patch) }
        }
        // Bundles go whole: the server's schema requires every field.
        summarizer = AutosavedValue(
            settings.summarizer,
            activity: activity,
            validate: SettingsValidation.summarizer
        ) { next, _ in
            try await api.updateSummarizer(next)
        }
        atmosphere = AutosavedValue(
            settings.atmosphere,
            activity: activity,
            validate: SettingsValidation.atmosphere
        ) { next, _ in
            try await api.updateAtmosphere(next)
        }
        requireZdr = AutosavedValue(settings.requireZdr, debounce: .milliseconds(250), activity: activity) { next, _ in
            try await api.updateAppSettings(["requireZdr": .bool(next)])
        }
        defaultImageModel = AutosavedValue(settings.defaultImageModelId, debounce: .milliseconds(250), activity: activity) { next, _ in
            try await api.updateAppSettings(["defaultImageModelId": .optional(next)])
        }
        imageContext = AutosavedValue(
            settings.imageContextTokens,
            debounce: .milliseconds(250),
            activity: activity,
            validate: SettingsValidation.imageContext
        ) { next, _ in
            try await api.updateAppSettings(["imageContextTokens": .number(Double(next))])
        }
    }

    func receive(_ settings: AppSettings) {
        defaults.receive(settings.defaultGeneration)
        summarizer.receive(settings.summarizer)
        atmosphere.receive(settings.atmosphere)
        requireZdr.receive(settings.requireZdr)
        defaultImageModel.receive(settings.defaultImageModelId)
        imageContext.receive(settings.imageContextTokens)
    }

    /// Sends every waiting edit, so leaving the screen never drops one.
    func flush() async {
        await defaults.flush()
        await summarizer.flush()
        await atmosphere.flush()
        await requireZdr.flush()
        await defaultImageModel.flush()
        await imageContext.flush()
    }
}
