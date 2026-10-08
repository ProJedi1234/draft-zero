import SwiftUI

/// Shown above the fields when an edit failed to save; the edit is still here to retry.
struct LorebookSaveFailureSection: View {
    let message: String
    let retry: () -> Void

    var body: some View {
        Section {
            Label(message, systemImage: "exclamationmark.triangle.fill")
                .foregroundStyle(.red)
            Button("Try Again", systemImage: "arrow.clockwise", action: retry)
        } header: {
            Text("Not Saved")
        }
    }
}
