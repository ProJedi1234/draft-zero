import Foundation

/// How a finished run ended.
nonisolated enum RunEndStatus: String, Codable, Sendable {
    case ok
    case aborted
    case error

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = RunEndStatus(rawValue: raw) ?? .error
    }
}
