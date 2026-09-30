import Foundation

/// The server's own rules, checked before a write so a bad value is refused
/// here with the sentence the server would have sent. Mirrors
/// lib/services/settings.schema.ts and profiles.schema.ts, in their key order.
nonisolated enum SettingsValidation {
    static func summarizer(_ value: AppSettings.Summarizer) -> String? {
        if !within(value.temperature, 0...2) { return "Temperature must be between 0 and 2." }
        if let words = value.targetWords, !within(words, 25...2000) { return "Summary length must be 25–2000 words." }
        if let cap = value.maxTokens, !within(cap, 64...8192) { return "Output cap must be 64–8192 tokens." }
        return nil
    }

    static func atmosphere(_ value: AppSettings.Atmosphere) -> String? {
        if !within(value.minConfidence, 0.5...0.95) { return "Confidence must be between 0.5 and 0.95." }
        if !within(value.temperature, 0...2) { return "Temperature must be between 0 and 2." }
        if !(16...32_000).contains(value.maxTokens) {
            return "Max tokens must be a whole number between 16 and 32000."
        }
        if !(1...50).contains(value.passagesBetweenChecks) {
            return "Passages between checks must be a whole number between 1 and 50."
        }
        return nil
    }

    /// Only the window has a closed set; the rest need only be numbers JSON can carry.
    static func generationDefaults(_ value: GenerationDefaults) -> String? {
        if !value.temperature.isFinite { return "Temperature must be a number." }
        if !value.topP.isFinite { return "Top P must be a number." }
        if !GenerationLimits.contextWindows.contains(value.contextWindow) { return "Unsupported context window." }
        if !value.loreBudget.isFinite { return "Lore budget must be a number." }
        if !value.frequencyPenalty.isFinite { return "Frequency penalty must be a number." }
        if !value.presencePenalty.isFinite { return "Presence penalty must be a number." }
        return nil
    }

    static func imageContext(_ tokens: Int) -> String? {
        GenerationLimits.imageContextOptions.contains(tokens) ? nil : "Unsupported image context size."
    }

    static func profile(name: String, settings: ProfileSettings) -> String? {
        if name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return "Name the profile." }
        if settings.modelId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return "Pick a model." }
        if let window = settings.contextWindow, !GenerationLimits.contextWindows.contains(window) {
            return "Unsupported context window."
        }
        return nil
    }

    private static func within(_ value: Double, _ range: ClosedRange<Double>) -> Bool {
        value.isFinite && range.contains(value)
    }
}
