import SwiftUI

/// The Continue card's painted affordance. Not a control: the whole card is
/// the button, and two targets for one destination would be two things to aim at.
struct ContinuePill: View {
    var body: some View {
        Label("Continue", systemImage: "arrow.right")
            .labelStyle(TrailingIconLabelStyle())
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(.white)
            .padding(.horizontal, 14)
            .padding(.vertical, 7)
            .background(.tint, in: .capsule)
            .accessibilityHidden(true)
    }
}
