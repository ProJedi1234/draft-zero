import Foundation
import Observation

/// Whether any settings write is travelling, and a brief "saved" once the
/// last one lands. The screen shows it quietly under its title.
@Observable
final class SaveActivity {
    enum Status: Equatable {
        case idle
        case saving
        case saved
    }

    private(set) var status: Status = .idle
    /// Bumped whenever a write finishes, so a read that overlapped one can tell.
    private(set) var settledWrites = 0

    @ObservationIgnored private var inFlight = 0
    @ObservationIgnored private var fade: Task<Void, Never>?

    var isBusy: Bool { inFlight > 0 }

    func begin() {
        inFlight += 1
        fade?.cancel()
        status = .saving
    }

    func end(succeeded: Bool) {
        inFlight = max(0, inFlight - 1)
        settledWrites += 1
        guard inFlight == 0 else { return }
        guard succeeded else {
            status = .idle
            return
        }
        status = .saved
        fade = Task { [weak self] in
            try? await Task.sleep(for: .seconds(2))
            guard !Task.isCancelled else { return }
            self?.status = .idle
        }
    }

    /// Runs one write under the indicator.
    func track<T>(_ work: () async throws -> T) async throws -> T {
        begin()
        do {
            let result = try await work()
            end(succeeded: true)
            return result
        } catch {
            end(succeeded: false)
            throw error
        }
    }
}
