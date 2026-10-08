import SwiftUI

/// Stands in for the server-backed sections until they load, or says why not.
struct SettingsLoadingSection: View {
    let error: String?
    let retry: () -> Void

    var body: some View {
        Section {
            if let error {
                ContentUnavailableView {
                    Label("Couldn't Load Settings", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(error)
                } actions: {
                    Button("Try Again", action: retry)
                }
            } else {
                HStack {
                    Spacer()
                    ProgressView("Loading settings…")
                    Spacer()
                }
                .padding(.vertical)
            }
        }
    }
}
