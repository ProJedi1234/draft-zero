import Foundation

/// Where an entry's autosave is, for the editor's status line.
nonisolated enum LorebookSaveState: Equatable, Sendable {
    /// Nothing written since the editor opened.
    case idle
    /// Edits are waiting for a pause, or a write is in flight.
    case saving
    case saved
    case failed(String)

    var text: String {
        switch self {
        case .idle: ""
        case .saving: "Saving…"
        case .saved: "Saved"
        case .failed: "Not saved"
        }
    }

    var failureMessage: String? {
        if case .failed(let message) = self { message } else { nil }
    }
}
