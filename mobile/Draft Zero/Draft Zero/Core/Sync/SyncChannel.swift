import Foundation
import Observation

/// The long-lived "something changed" channel every open device holds.
///
/// Reconnects on its own ladder for as long as the app is active. Events and
/// reconnects fan out to whoever subscribed: the library, the open story. A
/// reconnect matters because events emitted while the socket was down are gone
/// for good, so each subscriber re-probes what it cares about.
@Observable
final class SyncChannel {
    enum State: Equatable {
        case idle
        case connecting
        case open
        case retrying(attempt: Int)
    }

    private(set) var state: State = .idle

    @ObservationIgnored private var api: APIClient?
    @ObservationIgnored private var loop: Task<Void, Never>?
    @ObservationIgnored private var eventHandlers: [UUID: (SyncWireEvent) -> Void] = [:]
    @ObservationIgnored private var reconnectHandlers: [UUID: () -> Void] = [:]
    /// True once any socket has opened, so the next open is a reconnect.
    @ObservationIgnored private var hasOpenedBefore = false

    /// Starts (or restarts) the channel against a server.
    func start(api: APIClient) {
        self.api = api
        loop?.cancel()
        hasOpenedBefore = false
        loop = Task { [weak self] in await self?.run() }
    }

    func stop() {
        loop?.cancel()
        loop = nil
        state = .idle
    }

    /// The app came back to the foreground: a backgrounded socket may be dead
    /// without having said so, so replace it now rather than wait for the stall guard.
    func wake() {
        guard api != nil else { return }
        loop?.cancel()
        loop = Task { [weak self] in await self?.run() }
    }

    /// Delivers every event, on the main actor, until the token is released.
    func subscribe(_ handler: @escaping (SyncWireEvent) -> Void) -> SyncSubscription {
        let id = UUID()
        eventHandlers[id] = handler
        return SyncSubscription { [weak self] in self?.eventHandlers[id] = nil }
    }

    /// Called whenever the socket opens after an earlier open or a failed attempt.
    func onReconnect(_ handler: @escaping () -> Void) -> SyncSubscription {
        let id = UUID()
        reconnectHandlers[id] = handler
        return SyncSubscription { [weak self] in self?.reconnectHandlers[id] = nil }
    }

    private func run() async {
        var failures = 0
        while !Task.isCancelled, let api {
            state = failures == 0 ? .connecting : .retrying(attempt: failures)
            do {
                let events = try await api.syncEvents()
                for try await event in events {
                    if Task.isCancelled { return }
                    if case .hello = event {
                        // A launch with no server failed its first reads too, so a first
                        // open after failed attempts re-probes like any reconnect.
                        let missedSome = hasOpenedBefore || failures > 0
                        failures = 0
                        state = .open
                        if missedSome {
                            for handler in reconnectHandlers.values { handler() }
                        }
                        hasOpenedBefore = true
                        continue
                    }
                    for handler in eventHandlers.values { handler(event) }
                }
            } catch is CancellationError {
                return
            } catch {
                if Task.isCancelled { return }
            }
            if Task.isCancelled { return }
            state = .retrying(attempt: failures + 1)
            try? await Task.sleep(for: SyncTiming.reconnectDelay(after: failures))
            failures += 1
        }
    }
}

/// Keeps a sync handler registered for as long as it is held.
final class SyncSubscription {
    private let cancel: () -> Void
    private var cancelled = false

    init(cancel: @escaping () -> Void) {
        self.cancel = cancel
    }

    func release() {
        guard !cancelled else { return }
        cancelled = true
        cancel()
    }

    isolated deinit {
        release()
    }
}
