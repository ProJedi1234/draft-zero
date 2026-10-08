import SwiftUI

/// One tag from an imported file, as a chip.
struct ImportTag: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.footnote)
            .foregroundStyle(.secondary)
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background(.fill.tertiary, in: .capsule)
    }
}
