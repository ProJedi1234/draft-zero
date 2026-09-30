import SwiftUI

/// Review, then result: what a file contains, the write, and what came of it.
/// Dismissal is held while the write is in flight, since cancelling would not
/// stop the rows landing.
struct ImportSheet: View {
    let onOpenStory: (String) -> Void

    @Environment(AppModel.self) private var app
    @Environment(LibraryStore.self) private var library
    @Environment(\.dismiss) private var dismiss
    @State private var session: ImportSession

    init(pending: PendingImport, onOpenStory: @escaping (String) -> Void) {
        _session = State(initialValue: ImportSession(content: pending.content))
        self.onOpenStory = onOpenStory
    }

    var body: some View {
        NavigationStack {
            Group {
                if case .imported(let summary) = session.phase {
                    ImportSummaryView(summary: summary, fallbackTitle: session.previewTitle, onOpenStory: onOpenStory)
                } else {
                    ImportReviewForm(session: session)
                }
            }
            .navigationTitle(isDone ? "Imported" : "Import")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if isDone {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done", action: close)
                    }
                } else {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel", role: .cancel, action: close)
                            .disabled(session.isImporting)
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        if session.isImporting {
                            ProgressView()
                                .accessibilityLabel("Importing")
                        } else {
                            Button("Import", action: startImport)
                        }
                    }
                }
            }
        }
        .interactiveDismissDisabled(session.isImporting)
        .alert("Couldn't Import", isPresented: $session.isShowingFailure) {
        } message: {
            Text(session.failure ?? "")
        }
        .sensoryFeedback(.success, trigger: isDone)
        #if DEBUG
        .task {
            if ImportLaunchHook.commitsAutomatically { startImport() }
        }
        #endif
    }

    private var isDone: Bool {
        if case .imported = session.phase { true } else { false }
    }

    private func close() {
        dismiss()
    }

    private func startImport() {
        Task {
            await session.commit(using: app.api)
            if isDone { library.scheduleRefresh() }
        }
    }
}
