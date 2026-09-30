import Foundation

/// A "use the built-in default" row for pickers whose nil means "follow the
/// server's choice", like the summarizer's model.
nonisolated struct ModelDefaultOption: Equatable, Sendable {
    /// "Built-in default".
    var title: String
    /// What nil resolves to today.
    var modelId: String
}
