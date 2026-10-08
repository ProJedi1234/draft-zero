import SwiftUI

/// A small filled circle that colours a status word.
struct StatusDot: View {
    let color: Color

    var body: some View {
        Image(systemName: "circle.fill")
            .font(.caption2)
            .foregroundStyle(color)
            .accessibilityHidden(true)
    }
}
