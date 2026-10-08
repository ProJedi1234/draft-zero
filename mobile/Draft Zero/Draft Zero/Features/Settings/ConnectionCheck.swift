import Foundation

/// The Server section's on-demand health probe.
nonisolated enum ConnectionCheck: Equatable, Sendable {
    case idle
    case running
    case healthy(Duration)
    case failed(String)

    var isRunning: Bool { self == .running }

    /// "Healthy · 23 ms".
    static func describe(_ roundTrip: Duration) -> String {
        let milliseconds = max(1, Int((roundTrip / .milliseconds(1)).rounded()))
        return "Healthy · \(milliseconds) ms"
    }
}
