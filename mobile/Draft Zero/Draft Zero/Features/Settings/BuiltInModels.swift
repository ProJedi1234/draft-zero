import Foundation

/// The models the server falls back to when a bundle names none. Mirrors the
/// constants in lib/generation/summary-prompt.ts, atmosphere-prompt.ts and
/// atmosphere-decision.ts.
nonisolated enum BuiltInModels {
    static let summarizer = "~deepseek/deepseek-v4-flash-latest"
    static let atmosphere = "~deepseek/deepseek-v4-flash-latest"
    /// The decision engine's model until the writer picks one. Only the
    /// decision picker offers it: it takes typed questions, not messages.
    static let atmosphereDecision = "typesafe/jev-1.13"

    static let summarizerOption = ModelDefaultOption(title: "Built-in default", modelId: summarizer)
    static let atmosphereOption = ModelDefaultOption(title: "Built-in default", modelId: atmosphere)
}

/// Mirrors `LOCAL_MODEL_PREFIX` in lib/types.ts: no OpenRouter id starts this way.
nonisolated enum LocalModels {
    static let idPrefix = "ollama:"
}
