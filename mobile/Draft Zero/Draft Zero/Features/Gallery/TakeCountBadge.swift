import SwiftUI

/// Says a tile holds more than one draw, so a retry never looks like it
/// replaced the earlier ones.
struct TakeCountBadge: View {
    let count: Int

    var body: some View {
        Label("\(count)", systemImage: "photo.stack")
            .font(.caption.bold())
            .monospacedDigit()
            .foregroundStyle(.white)
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background(.black.opacity(0.55), in: .capsule)
            .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
            .padding(5)
            .accessibilityHidden(true)
    }
}
