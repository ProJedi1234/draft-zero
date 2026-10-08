import Foundation

/// The OpenRouter section's key verification. A failed check is a result, not an error.
nonisolated enum KeyCheck: Equatable, Sendable {
    case idle
    case running
    case answered(verified: Bool, message: String)
    case failed(String)

    var isRunning: Bool { self == .running }
}
