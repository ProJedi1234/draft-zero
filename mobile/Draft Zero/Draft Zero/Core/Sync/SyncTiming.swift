import Foundation

/// Cadences shared with the server. See SYNC_PING_INTERVAL_MS in lib/sync/types.ts.
nonisolated enum SyncTiming {
    /// The server pings both channels at this interval.
    static let pingInterval: Duration = .seconds(20)
    /// Silence past about two pings means the socket is dead.
    static let stallTimeout: Duration = .seconds(50)
    /// Sync channel reconnect ladder, then the last step forever.
    static let reconnectBackoff: [Duration] = [.seconds(1), .seconds(2), .seconds(5), .seconds(10)]
    /// Run re-attach ladder after a dropped subscribe stream.
    static let reattachBackoff: [Duration] = [.milliseconds(500), .seconds(1), .seconds(2)]
    /// Where the re-attach ladder settles for as long as a run is unreachable.
    static let reattachIdleBackoff: Duration = .seconds(10)
    /// Consecutive subscribe failures before the writer is told.
    static let subscribeFailureNotice = 4
    /// How long a composer change waits before it is saved and announced.
    static let draftDebounce: Duration = .milliseconds(600)
    /// How long to wait for a refreshed workspace to deliver a finished run's rows.
    static let settleTimeout: Duration = .seconds(6)
    /// A stopped call is priced after the fact; refresh once that has had time.
    static let reconcileRefreshDelay: Duration = .seconds(17)

    static func reattachDelay(after failures: Int) -> Duration {
        failures < reattachBackoff.count ? reattachBackoff[failures] : reattachIdleBackoff
    }

    static func reconnectDelay(after failures: Int) -> Duration {
        reconnectBackoff[min(failures, reconnectBackoff.count - 1)]
    }
}
