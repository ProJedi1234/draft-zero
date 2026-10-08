import Foundation
import Observation
import SwiftUI

/// Transient messages for things the writer did not just ask about, or asked
/// about and cannot see: a failed save, a run that errored, a summarizer that
/// gave up. The web shows these as toasts.
@Observable
final class NoticeCenter {
    struct Notice: Identifiable, Equatable {
        enum Style: Equatable {
            case info
            case error
        }

        let id = UUID()
        let message: String
        let style: Style
        var actionTitle: String?
        var action: (() -> Void)?

        static func == (lhs: Notice, rhs: Notice) -> Bool {
            lhs.id == rhs.id
        }
    }

    private(set) var current: Notice?
    @ObservationIgnored private var dismissal: Task<Void, Never>?

    func error(_ message: String) {
        show(Notice(message: message, style: .error))
    }

    func error(_ error: Error, fallback: String = "Something went wrong.") {
        if error is CancellationError { return }
        let message = (error as? LocalizedError)?.errorDescription ?? fallback
        show(Notice(message: message, style: .error))
    }

    func info(_ message: String) {
        show(Notice(message: message, style: .info))
    }

    /// A message with one reversing action, such as Undo.
    func info(_ message: String, actionTitle: String, action: @escaping () -> Void) {
        show(Notice(message: message, style: .info, actionTitle: actionTitle, action: action))
    }

    func dismiss() {
        dismissal?.cancel()
        current = nil
    }

    private func show(_ notice: Notice) {
        current = notice
        AccessibilityNotification.Announcement(notice.message).post()
        dismissal?.cancel()
        dismissal = Task { [weak self] in
            try? await Task.sleep(for: .seconds(notice.action != nil ? 6 : notice.style == .error ? 5 : 3))
            guard !Task.isCancelled else { return }
            self?.current = nil
        }
    }
}
