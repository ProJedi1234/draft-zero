import SwiftUI

/// Says an edit didn't reach the server, and offers to send it again or to
/// drop it for what the server has.
struct InspectorUnsavedRow: View {
    let retry: () -> Void
    let discard: () -> Void

    var body: some View {
        HStack {
            Label("Not saved", systemImage: "exclamationmark.triangle.fill")
                .foregroundStyle(.orange)
            Spacer()
            Button("Discard", role: .destructive, action: discard)
                .buttonStyle(.borderless)
            Button("Retry", action: retry)
                .buttonStyle(.borderless)
                .bold()
        }
        .font(.subheadline)
    }
}
