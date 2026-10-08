import Foundation

/// The coupling every model picker enforces, applied to the app-wide bundles:
/// a provider tag names an endpoint of the old model, and a thinking level
/// the new model does not offer would be rejected on send.
extension AppSettings.Summarizer {
    mutating func chooseModel(_ modelId: String?, in models: [OpenRouterModel]) {
        guard modelId != self.modelId else { return }
        let resolved = modelId ?? BuiltInModels.summarizer
        self.modelId = modelId
        providerTag = nil
        thinking = ModelCatalog.levelForModel(models.first { $0.id == resolved }?.reasoning, current: thinking)
    }

    /// Back to "auto": the cap follows the target, so both go together.
    mutating func useAutoLength() {
        targetWords = nil
        maxTokens = nil
    }
}
