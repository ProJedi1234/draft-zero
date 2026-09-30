import SwiftUI

/// The manuscript and composer once the story has loaded, or why it has not.
struct StoryWorkspaceContent: View {
    let workspace: StoryWorkspace

    var body: some View {
        switch workspace.loadState {
        case .loading where workspace.story == nil:
            ProgressView("Opening…")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .notFound:
            ContentUnavailableView(
                "Story Not Found",
                systemImage: "questionmark.folder",
                description: Text("It may have been deleted on another device.")
            )
        case .failed(let message) where workspace.story == nil:
            ContentUnavailableView {
                Label("Couldn't Open Story", systemImage: "wifi.exclamationmark")
            } description: {
                Text(message)
            } actions: {
                Button("Try Again", action: retry)
                    .buttonStyle(.borderedProminent)
            }
        default:
            ManuscriptView(workspace: workspace)
                .safeAreaInset(edge: .bottom, spacing: 0) {
                    ComposerView(workspace: workspace)
                }
        }
    }

    private func retry() {
        Task { await workspace.refreshNow() }
    }
}
