import Foundation
import Observation

/// One entry's editing session: the writer's draft, the fields they have
/// touched, and a debounced autosave that sends only those.
///
/// A touched field stays dirty until a save carrying its current value is
/// acknowledged. Remote rows fold in field by field: a field adopts the remote
/// value only when the remote row moved it and the writer has not touched it,
/// so another device's edit never lands on text being typed here.
@Observable
final class LorebookEntryEditor {
    typealias Writer = (_ entryId: String, _ patch: JSONObject) async throws -> LorebookEntry

    let entryId: String

    var draft: NewLorebookEntry {
        didSet { draftChanged(from: oldValue) }
    }

    private(set) var saveState: LorebookSaveState = .idle
    /// The newest server row this draft has seen.
    private(set) var base: LorebookEntry
    private(set) var dirty: Set<LorebookField> = []

    /// Each saved row, so the screen's ledger folds it in.
    @ObservationIgnored var onSaved: ((LorebookEntry) -> Void)?
    /// A save found the entry gone: deleted on another device.
    @ObservationIgnored var onMissing: ((String) -> Void)?
    /// A switch or picker failed to save and was rolled back.
    @ObservationIgnored var onRevert: ((Error) -> Void)?
    /// Nothing is pending or in flight any more.
    @ObservationIgnored var onSettled: ((String) -> Void)?

    @ObservationIgnored private let write: Writer
    @ObservationIgnored private var applyingRemote = false
    @ObservationIgnored private var timer: Task<Void, Never>?
    @ObservationIgnored private var inFlight = false
    @ObservationIgnored private var saveAgain = false

    init(entry: LorebookEntry, write: @escaping Writer) {
        entryId = entry.id
        base = entry
        draft = NewLorebookEntry(entry: entry)
        self.write = write
    }

    var nameError: String? {
        draft.hasBlankName ? "Name is required. Changes to it aren't saved while it's blank." : nil
    }

    /// The row as the list should show it: the server's, with this draft on top.
    var displayed: LorebookEntry {
        base.overlaid(with: draft)
    }

    /// One line for the editor's title bar: the save in progress, or when the row last moved.
    var statusLine: String {
        if nameError != nil { return "Name required" }
        if saveState == .idle { return "Updated \(Format.relativeDate(base.updatedAt))" }
        return saveState.text
    }

    var isSettled: Bool {
        dirty.isEmpty && !inFlight && timer == nil
    }

    /// Dirty fields a save can send now; a blank name waits for a real one.
    private var sendable: Set<LorebookField> {
        draft.hasBlankName ? dirty.subtracting([.name]) : dirty
    }

    // MARK: - Remote rows

    /// Folds in a newer server row, leaving the writer's touched fields alone.
    func adopt(_ row: LorebookEntry) {
        guard row.id == entryId, row.updatedAt >= base.updatedAt, row != base else { return }
        let moved = LorebookField.changed(from: base, to: row).subtracting(dirty)
        base = row
        guard !moved.isEmpty else { return }
        var next = draft
        for field in moved { field.copy(from: row, into: &next) }
        applyingRemote = true
        draft = next
        applyingRemote = false
    }

    // MARK: - Saving

    /// Sends pending edits now instead of after the pause.
    func flush() {
        timer?.cancel()
        timer = nil
        Task { await save() }
    }

    /// Stops any pending save, for an entry that is gone.
    func cancel() {
        timer?.cancel()
        timer = nil
        dirty = []
    }

    /// A blank name is never saved; closing the editor puts the saved one back.
    func discardBlankName() {
        guard draft.hasBlankName else { return }
        dirty.remove(.name)
        var next = draft
        LorebookField.name.copy(from: base, into: &next)
        applyingRemote = true
        draft = next
        applyingRemote = false
        if saveState == .saving, sendable.isEmpty, !inFlight { saveState = .idle }
        settleIfIdle()
    }

    func save() async {
        timer?.cancel()
        timer = nil
        if inFlight {
            saveAgain = true
            return
        }
        let fields = sendable
        guard !fields.isEmpty else {
            if saveState == .saving { saveState = .idle }
            settleIfIdle()
            return
        }
        let sent = draft
        inFlight = true
        saveState = .saving
        do {
            let record = try await write(entryId, LorebookField.patch(fields, from: sent))
            adopt(record)
            onSaved?(record)
            let movedSince = LorebookField.changed(from: sent, to: draft)
            dirty.subtract(fields.subtracting(movedSince))
            saveState = sendable.isEmpty ? .saved : .saving
        } catch let error as APIError where error.isNotFound {
            inFlight = false
            timer?.cancel()
            timer = nil
            onMissing?(entryId)
            return
        } catch {
            rollBack(fields.subtracting(LorebookField.changed(from: sent, to: draft)), after: error)
        }
        inFlight = false
        if saveAgain {
            saveAgain = false
            await save()
        } else {
            settleIfIdle()
        }
    }

    private func draftChanged(from old: NewLorebookEntry) {
        guard !applyingRemote else { return }
        let changed = LorebookField.changed(from: old, to: draft)
        guard !changed.isEmpty else { return }
        dirty.formUnion(changed)
        if !sendable.isEmpty { saveState = .saving }
        schedule(after: changed.map(\.saveDelay).min() ?? .zero)
    }

    private func schedule(after delay: Duration) {
        timer?.cancel()
        timer = Task { [weak self] in
            if delay > .zero {
                try? await Task.sleep(for: delay)
            }
            guard !Task.isCancelled, let self else { return }
            self.timer = nil
            await self.save()
        }
    }

    /// Switches and pickers go back to the server's value; typed text stays for a retry.
    private func rollBack(_ unchanged: Set<LorebookField>, after error: Error) {
        let reverting = unchanged.filter(\.revertsOnFailure)
        if !reverting.isEmpty {
            dirty.subtract(reverting)
            var next = draft
            for field in reverting { field.copy(from: base, into: &next) }
            applyingRemote = true
            draft = next
            applyingRemote = false
            onRevert?(error)
        }
        let message = (error as? LocalizedError)?.errorDescription ?? "Couldn't save this entry."
        saveState = sendable.isEmpty ? .idle : .failed(message)
    }

    private func settleIfIdle() {
        if isSettled { onSettled?(entryId) }
    }
}
