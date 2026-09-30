import SwiftUI

/// A still place-marker where the next passage will begin. The composer is
/// where you type, so it deliberately does not blink like a cursor.
struct RestingMark: View {
    var body: some View {
        Capsule()
            .fill(.tint.opacity(0.3))
            .frame(width: 2, height: 20)
            .padding(.top, 12)
            .accessibilityHidden(true)
    }
}
