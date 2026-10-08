import Foundation

/// Pages on openrouter.ai the settings point writers to.
nonisolated enum OpenRouterLinks {
    /// Where the account-wide data policy lives; this app can only read it through failures.
    static let privacySettings: URL = {
        guard let url = URL(string: "https://openrouter.ai/settings/privacy") else {
            fatalError("The OpenRouter privacy URL is malformed.")
        }
        return url
    }()
}
