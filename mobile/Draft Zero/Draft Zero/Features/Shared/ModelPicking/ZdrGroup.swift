import Foundation

/// OpenRouter's five model groups. Its privacy settings carry one zero-data-
/// retention toggle per group, so every question about what the account
/// enforces is a question about one group. Mirrors `ZDR_GROUPS` in lib/types.ts.
nonisolated enum ZdrGroup: String, CaseIterable, Identifiable, Sendable {
    case anthropic
    case openai
    case google
    case xai
    case other

    var id: String { rawValue }

    /// The name inside a sentence: "Anthropic, OpenAI and other providers".
    var label: String {
        switch self {
        case .anthropic: "Anthropic"
        case .openai: "OpenAI"
        case .google: "Google"
        case .xai: "xAI"
        case .other: "other providers"
        }
    }

    /// The name as a row title.
    var title: String {
        self == .other ? "Other providers" : label
    }

    /// The group a model's retention is decided by: its author, alias prefix
    /// stripped, with OpenRouter's "x-ai" slug mapped to xAI.
    init(modelId: String) {
        var id = Substring(modelId)
        if id.hasPrefix("~") { id = id.dropFirst() }
        let author = id.split(separator: "/", maxSplits: 1).first.map(String.init) ?? ""
        switch author {
        case "anthropic": self = .anthropic
        case "openai": self = .openai
        case "google": self = .google
        case "x-ai": self = .xai
        default: self = .other
        }
    }
}
