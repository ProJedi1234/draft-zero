import SwiftUI

/// The explicit step that makes a previewed take the story's own.
struct UseTakeButton: View {
    let isWorking: Bool
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            if isWorking {
                ProgressView()
            } else {
                Label("Use This Take", systemImage: "checkmark")
            }
        }
        .buttonStyle(.glassProminent)
        .disabled(isWorking)
    }
}
