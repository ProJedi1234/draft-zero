import SwiftUI

/// The alternate-model action opens a searchable catalog rather than a long menu.
struct RetryMenu: View {
    let workspace: StoryWorkspace
    let disabled: Bool

    @State private var showsModels = false

    var body: some View {
        Menu {
            Button("Retry", systemImage: "arrow.clockwise", action: retry)

            Button("Retry with Other Model", systemImage: "sparkles") {
                showsModels = true
            }
        } label: {
            Label("Retry", systemImage: "arrow.clockwise")
        }
        .menuOrder(.fixed)
        .disabled(disabled || !workspace.generation.canRetry)
        .accessibilityHint("Retry using the story's settings, a preset, or another model. This take only.")
        .sheet(isPresented: $showsModels) {
            RetryModelSheet(workspace: workspace)
        }
    }

    private func retry() {
        workspace.generation.retryLast()
    }
}
