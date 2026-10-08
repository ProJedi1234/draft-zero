import Foundation
import Observation

/// One setting edited in place and saved on its own: the value on screen, the
/// value the server last confirmed, and the write that reconciles them.
///
/// Edits are debounced so a slider saves once it settles rather than on every
/// tick. While an edit waits or travels, refreshes from the server are held
/// off, so another device's echo cannot yank a control out from under a finger.
@Observable
final class AutosavedValue<Value: Equatable & Sendable> {
    var value: Value {
        didSet {
            if value != oldValue { scheduleSave() }
        }
    }

    private(set) var server: Value
    /// The last failure, shown under the control; cleared when the value next moves.
    private(set) var error: String?
    private(set) var isSaving = false

    @ObservationIgnored private let debounce: Duration
    @ObservationIgnored private let activity: SaveActivity?
    @ObservationIgnored private let validate: (Value) -> String?
    @ObservationIgnored private let write: (_ next: Value, _ previous: Value) async throws -> Void
    @ObservationIgnored private var pending: Task<Void, Never>?

    /// - Parameters:
    ///   - value: The server's value to start from.
    ///   - debounce: How long the value must sit still before it is sent.
    ///   - activity: The screen-wide indicator this write reports to.
    ///   - validate: The server's own rule, checked first; a message refuses the write.
    ///   - write: Sends the new value; `previous` is the last confirmed one, for diffs.
    init(
        _ value: Value,
        debounce: Duration = .milliseconds(500),
        activity: SaveActivity? = nil,
        validate: @escaping (Value) -> String? = { _ in nil },
        write: @escaping (_ next: Value, _ previous: Value) async throws -> Void
    ) {
        self.value = value
        self.server = value
        self.debounce = debounce
        self.activity = activity
        self.validate = validate
        self.write = write
    }

    /// True while an edit is waiting or travelling.
    var isPending: Bool { pending != nil || isSaving }

    /// Adopts the server's value unless a local edit is still unresolved.
    func receive(_ serverValue: Value) {
        guard !isPending else { return }
        server = serverValue
        if value != serverValue { value = serverValue }
    }

    /// Sends any waiting edit now rather than after the debounce.
    func flush() async {
        pending?.cancel()
        pending = nil
        await save()
    }

    private func scheduleSave() {
        pending?.cancel()
        pending = nil
        guard value != server else { return }
        error = nil
        pending = Task { [weak self, debounce] in
            try? await Task.sleep(for: debounce)
            guard !Task.isCancelled, let self else { return }
            self.pending = nil
            await self.save()
        }
    }

    private func save() async {
        guard !isSaving, value != server else { return }
        let next = value
        if let problem = validate(next) {
            error = problem
            return
        }
        let previous = server
        isSaving = true
        activity?.begin()
        do {
            try await write(next, previous)
            server = next
            isSaving = false
            activity?.end(succeeded: true)
            // The writer kept moving while this travelled; send where they stopped.
            if value != server { scheduleSave() }
        } catch {
            isSaving = false
            activity?.end(succeeded: false)
            self.error = (error as? LocalizedError)?.errorDescription ?? "Couldn't save."
            value = previous
        }
    }
}
