import Foundation

/// What an image model picker's nil means.
nonisolated enum ImageModelFallback: Equatable, Sendable {
    /// Settings: the first model the catalog lists that the policy allows.
    case catalog
    /// A story: the app's default, resolved by the server, or the catalog's if unset.
    case appDefault(String?)

    /// The model nil stands for today.
    func resolve(in models: [OpenRouterImageModel], zdr: Bool) -> String? {
        let catalogFirst = ModelCatalog.partition(models, zdr: zdr).allowed.first?.id ?? models.first?.id
        switch self {
        case .catalog: return catalogFirst
        case .appDefault(let id): return id ?? catalogFirst
        }
    }

    var title: String {
        switch self {
        case .catalog: "Catalog default"
        case .appDefault: "Default"
        }
    }

    var caption: String {
        switch self {
        case .catalog: "The first model OpenRouter lists that your policy allows."
        case .appDefault: "The image model set in Settings."
        }
    }
}
