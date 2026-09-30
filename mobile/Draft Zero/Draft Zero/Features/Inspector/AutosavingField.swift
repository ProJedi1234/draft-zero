import Foundation
import Observation

/// A story field edited in place and saved on its own after a pause: text,
/// or a slider. Built on `ServerSyncedValue`, so it holds the local value
/// while focused, while an edit waits, and while a save is unacknowledged.
///
/// Only an edit the writer made is ever saved. Focusing a field and leaving
/// it writes nothing, so a field that sat focused while another device
/// changed the row does not write the old text back over it.
@Observable
final class AutosavingField<Value: Equatable> {
    enum OnFailure {
        /// Put the control back, as a slider does.
        case revert
        /// Keep the edit on screen, held and marked unsaved, as typed text does.
        case keepEdit
    }

    let sync: ServerSyncedValue<Value>
    private(set) var isFocused = false
    /// The last save failed and the edit on screen is not on the server.
    private(set) var saveFailed = false
    private(set) var isSaving = false

    /// An edit not yet sent.
    @ObservationIgnored private var dirty = false
    @ObservationIgnored private var pending: Task<Void, Never>?
    @ObservationIgnored private let debounce: Duration
    @ObservationIgnored private let onFailure: OnFailure
    @ObservationIgnored private let read: () -> (value: Value, version: String)?
    @ObservationIgnored private let persist: (Value) async -> Bool

    /// - Parameters:
    ///   - value: The server's value to start from.
    ///   - version: The row version it came from.
    ///   - debounce: How long an edit must sit still before it is sent.
    ///   - onFailure: What a refused save does to the edit on screen.
    ///   - read: The server's current value and version, pulled before a save
    ///     resolves so its echo is already known when following resumes.
    ///   - persist: Sends a value; true when the server took it.
    init(
        _ value: Value,
        version: String,
        debounce: Duration = .milliseconds(600),
        onFailure: OnFailure,
        read: @escaping () -> (value: Value, version: String)?,
        persist: @escaping (Value) async -> Bool
    ) {
        sync = ServerSyncedValue(value, version: version)
        self.debounce = debounce
        self.onFailure = onFailure
        self.read = read
        self.persist = persist
    }

    /// What the control shows; setting it is an edit.
    var value: Value {
        get { sync.value }
        set { edit(newValue) }
    }

    /// True while anything local is waiting to reach the server.
    var hasPendingEdit: Bool { dirty || sync.inFlight > 0 }

    func edit(_ next: Value) {
        guard next != sync.value else { return }
        sync.setLocal(next)
        dirty = true
        saveFailed = false
        updateHold()
        schedule()
    }

    /// Focus holds the value; losing it sends any waiting edit now.
    func setFocused(_ focused: Bool) {
        guard focused != isFocused else { return }
        isFocused = focused
        updateHold()
        if !focused {
            Task { await flush() }
        }
    }

    /// Pulls the server's current value in; adopted only if the field is idle.
    func pull() {
        guard let current = read() else { return }
        sync.receive(current.value, version: current.version)
    }

    /// Sends any waiting edit now rather than after the pause.
    func flush() async {
        pending?.cancel()
        pending = nil
        await commit()
    }

    /// Drops an unsent or refused edit and goes back to following the server.
    func discardEdit() {
        pending?.cancel()
        pending = nil
        dirty = false
        saveFailed = false
        updateHold()
    }

    private func schedule() {
        pending?.cancel()
        pending = Task { [weak self, debounce] in
            try? await Task.sleep(for: debounce)
            guard !Task.isCancelled, let self else { return }
            self.pending = nil
            await self.commit()
        }
    }

    private func commit() async {
        guard dirty else { return }
        dirty = false
        let next = sync.value
        let previous = sync.server
        let counted = sync.write(next)
        updateHold()
        guard counted else { return }

        isSaving = true
        let succeeded = await persist(next)
        isSaving = false
        pull()
        if succeeded {
            saveFailed = false
            sync.settle()
            return
        }
        switch onFailure {
        case .keepEdit:
            dirty = true
            saveFailed = true
            updateHold()
            sync.resetServer(to: previous)
        case .revert:
            // A newer edit made during the flight is still on its way; keep it.
            if dirty {
                sync.resetServer(to: previous)
            } else {
                sync.reset(to: previous)
            }
        }
    }

    private func updateHold() {
        sync.hold(isFocused || dirty)
    }
}
