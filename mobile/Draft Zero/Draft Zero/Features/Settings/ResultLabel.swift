import SwiftUI

/// A check's answer: a coloured symbol beside a plain sentence.
struct ResultLabel: View {
    let message: String
    let systemImage: String
    let color: Color

    var body: some View {
        Label {
            Text(message)
                .foregroundStyle(.secondary)
        } icon: {
            Image(systemName: systemImage)
                .foregroundStyle(color)
        }
        .font(.subheadline)
    }
}
