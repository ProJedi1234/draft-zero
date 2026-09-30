import SwiftUI

/// The trailing checkmark on the chosen row of a picker list.
struct SelectionCheckmark: View {
    let isSelected: Bool

    var body: some View {
        Image(systemName: "checkmark")
            .font(.body.bold())
            // Explicit, because picker rows tint themselves primary for their text.
            .foregroundStyle(Color.accentColor)
            .opacity(isSelected ? 1 : 0)
            .accessibilityHidden(true)
    }
}
