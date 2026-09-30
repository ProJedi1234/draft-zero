import Foundation

/// How a billed call ended. `aborted` is a passage the writer stopped and kept.
nonisolated enum CallStatus: String, Codable, Sendable, Hashable {
    case ok
    case aborted
    case error
    case streaming

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = CallStatus(rawValue: raw) ?? .ok
    }
}
