import Foundation

/// Folds a burst of "something changed" signals into one reload. A signal that
/// lands mid-reload earns exactly one more pass, so nothing is missed.
final class RefreshCoalescer {
    private let delay: Duration
    private let reload: () async -> Void
    private var task: Task<Void, Never>?
    private var isRequested = false

    init(delay: Duration = .milliseconds(300), reload: @escaping () async -> Void) {
        self.delay = delay
        self.reload = reload
    }

    func request() {
        isRequested = true
        guard task == nil else { return }
        task = Task { [weak self] in
            try? await Task.sleep(for: self?.delay ?? .zero)
            while let self, self.isRequested, !Task.isCancelled {
                self.isRequested = false
                await self.reload()
            }
            self?.task = nil
        }
    }

    func cancel() {
        task?.cancel()
        task = nil
        isRequested = false
    }
}
