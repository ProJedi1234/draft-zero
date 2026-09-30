import Foundation

/// What the app has learned about the OpenRouter account's own retention
/// policy for one model group. `unknown` locks nothing.
nonisolated enum AccountZdrPolicy: String, Codable, Sendable {
    case enforced
    case notEnforced = "not-enforced"
    case unknown

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = AccountZdrPolicy(rawValue: raw) ?? .unknown
    }
}
