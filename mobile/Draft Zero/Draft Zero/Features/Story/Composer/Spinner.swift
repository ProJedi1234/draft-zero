import SwiftUI

/// The send slot's waiting state: a disabled prominent circle with a spinner.
struct Spinner: View {
    let label: String

    var body: some View {
        Button {} label: {
            ProgressView()
                .tint(.white)
        }
        .disabled(true)
        .accessibilityLabel(label)
    }
}
