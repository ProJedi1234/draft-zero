import Foundation
import Observation

/// The spend ledger's aggregates, kept fresh from the server and the sync
/// channel.
@Observable
final class UsageModel {
    private(set) var payload: UsagePayload?
    private(set) var loadError: APIError?

    @ObservationIgnored private var api: APIClient?
    @ObservationIgnored private var subscriptions: [SyncSubscription] = []
    @ObservationIgnored private lazy var coalescer = RefreshCoalescer { [weak self] in
        await self?.reload()
    }

    func attach(api: APIClient?) {
        self.api = api
        payload = nil
        loadError = nil
    }

    func start(sync: SyncChannel) {
        stop()
        subscriptions = [
            sync.subscribe { [weak self] event in self?.handle(event) },
            sync.onReconnect { [weak self] in self?.scheduleRefresh() },
        ]
    }

    func stop() {
        subscriptions.forEach { $0.release() }
        subscriptions = []
        coalescer.cancel()
    }

    func scheduleRefresh() {
        coalescer.request()
    }

    /// A failure is kept only while there is nothing to show, so a refresh
    /// that fails leaves the last figures on screen.
    func reload() async {
        guard let api else { return }
        do {
            payload = try await api.usage()
            loadError = nil
        } catch is CancellationError {
            return
        } catch {
            if payload == nil {
                loadError = error as? APIError ?? .transport(error.localizedDescription)
            }
        }
    }

    func handle(_ event: SyncWireEvent) {
        switch event {
        case .change, .runEnded:
            scheduleRefresh()
        default:
            break
        }
    }
}
