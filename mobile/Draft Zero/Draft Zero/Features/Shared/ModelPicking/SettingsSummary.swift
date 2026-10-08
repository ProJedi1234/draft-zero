import Foundation

/// The one-line rendering of a settings bundle: model, provider, thinking.
/// A port of lib/settings-summary.ts, so a profile reads the same on both clients.
nonisolated enum SettingsSummary {
    struct Parts: Equatable, Sendable {
        var model: String
        var provider: String
        var thinking: String
    }

    /// A model the catalog doesn't know degrades to its id, which is still true.
    static func parts(modelId: String, providerTag: String?, thinking: ThinkingLevel, models: [OpenRouterModel]) -> Parts {
        Parts(
            model: ModelCatalog.displayName(modelId, in: models),
            provider: providerTag ?? "Auto",
            thinking: thinking == .off ? "off" : "think \(thinking.label.lowercased())"
        )
    }

    /// "Claude Sonnet Latest · Auto · think medium".
    static func line(modelId: String, providerTag: String?, thinking: ThinkingLevel, models: [OpenRouterModel]) -> String {
        let parts = parts(modelId: modelId, providerTag: providerTag, thinking: thinking, models: models)
        return [parts.model, parts.provider, parts.thinking].joined(separator: " · ")
    }

    /// The same line with the model's per-1M prices, for the settings list.
    static func lineWithPrice(modelId: String, providerTag: String?, thinking: ThinkingLevel, models: [OpenRouterModel]) -> String {
        let summary = line(modelId: modelId, providerTag: providerTag, thinking: thinking, models: models)
        guard let model = models.first(where: { $0.id == modelId }) else { return summary }
        return "\(summary) · \(model.pricing.prompt)/\(model.pricing.completion)"
    }

    static func lineWithPrice(_ settings: ProfileSettings, models: [OpenRouterModel]) -> String {
        lineWithPrice(modelId: settings.modelId, providerTag: settings.providerTag, thinking: settings.thinking, models: models)
    }

    /// "In $2.00 · Out $10.00 per 1M · 1M context · up to 66K out" — the price and
    /// window of whatever will actually serve the request.
    static func pricing(_ pricing: OpenRouterModel.Pricing, contextLength: Int, maxCompletionTokens: Int?) -> String {
        var line = "In \(pricing.prompt) · Out \(pricing.completion) per 1M · \(Format.contextLength(contextLength)) context"
        if let maxCompletionTokens {
            line += " · up to \(Format.contextLength(maxCompletionTokens)) out"
        }
        return line
    }
}
