import SwiftUI

/// A refused save, under the section it belongs to.
struct SaveErrorLabel: View {
    let message: String?

    var body: some View {
        if let message {
            Label(message, systemImage: "exclamationmark.triangle.fill")
                .foregroundStyle(.red)
        }
    }
}
