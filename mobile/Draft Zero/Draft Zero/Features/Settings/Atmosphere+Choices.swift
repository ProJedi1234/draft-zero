import Foundation

/// The same coupling as the summarizer's, for the atmosphere's language model.
extension AppSettings.Atmosphere {
    mutating func chooseModel(_ modelId: String?, in models: [OpenRouterModel]) {
        guard modelId != self.modelId else { return }
        let resolved = modelId ?? BuiltInModels.atmosphere
        self.modelId = modelId
        providerTag = nil
        thinking = ModelCatalog.levelForModel(models.first { $0.id == resolved }?.reasoning, current: thinking)
    }
}
